import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { categoryNameKey, merchantKey, ruleCategoryNames, SUGGESTED_CATEGORIES, type SuggestedCategory } from "@/lib/domain/categorize";
import { createCategorizer } from "@/lib/domain/csv-import";
import { toCategory, toPlaceMemory } from "./mappers";

/**
 * Analyse et classement des transactions par commerçant (sans IA) : regroupement des lignes d'un
 * même commerçant, catégorie proposée (règles apprises, mémoire, mots-clés), catégories manquantes
 * à créer, et application en masse. Toujours filtré sur l'utilisateur passé en paramètre.
 */

export type Direction = "out" | "in";

/** Retient la catégorie d'un commerçant : elle vaudra pour ses prochaines lignes. */
export async function learnMerchant(userId: string, label: string | null, categoryId: string): Promise<void> {
  const key = merchantKey(label);
  if (!key) return;
  const r = s.merchantRules;
  await db
    .insert(r)
    .values({ user_id: userId, merchant_key: key, category_id: categoryId })
    .onConflictDoUpdate({ target: [r.user_id, r.merchant_key], set: { category_id: categoryId, updated_at: new Date() } });
}

export interface MerchantGroup {
  /** Clé commerçant + sens : un même commerçant peut avoir des dépenses et des recettes */
  id: string;
  merchantKey: string;
  direction: Direction;
  label: string;
  count: number;
  totalCents: number;
  /** Lignes encore dans « Autres » ou sans catégorie */
  uncategorized: number;
  /** Catégorie actuelle la plus fréquente du groupe */
  currentCategoryId: string | null;
  /** Catégorie proposée (null : rien ne permet de la deviner) */
  proposedCategoryId: string | null;
  /** Catégorie à créer qui conviendrait, quand aucune existante ne convient */
  suggestedName: string | null;
  lastDate: string;
}

export interface CategoryAnalysis {
  total: number;
  uncategorized: number;
  groups: MerchantGroup[];
  /** Catégories proposées à la création, avec le nombre de lignes qu'elles classeraient */
  suggestions: (SuggestedCategory & { count: number; examples: string[] })[];
}

async function loadContext(userId: string) {
  const [categories, memory, learned, rows] = await Promise.all([
    db.select().from(s.categories).where(eq(s.categories.user_id, userId)),
    db.select().from(s.placeMemory).where(eq(s.placeMemory.user_id, userId)).orderBy(desc(s.placeMemory.last_used)),
    db
      .select({ merchantKey: s.merchantRules.merchant_key, categoryId: s.merchantRules.category_id })
      .from(s.merchantRules)
      .where(eq(s.merchantRules.user_id, userId)),
    db
      .select({ id: s.transactions.id, place: s.transactions.place, amount: s.transactions.amount_cents, date: s.transactions.date, categoryId: s.transactions.category_id })
      .from(s.transactions)
      .where(and(eq(s.transactions.user_id, userId), inArray(s.transactions.type, ["in", "out"])))
      .orderBy(desc(s.transactions.date)),
  ]);
  const cats = categories.map(toCategory);
  const active = cats.filter((c) => !c.archivedAt);
  const autres = active.find((c) => categoryNameKey(c.name) === "autres") ?? null;
  return { cats, active, autres, categorizer: createCategorizer(cats, memory.map(toPlaceMemory), learned), rows };
}

/** Regroupe les dépenses et recettes par commerçant et propose une catégorie à chacun. */
export async function getCategoryAnalysis(userId: string): Promise<CategoryAnalysis> {
  const { active, autres, categorizer, rows } = await loadContext(userId);
  const existing = new Set(active.map((c) => categoryNameKey(c.name)));
  const isUncategorized = (id: string | null) => !id || id === autres?.id;

  const groups = new Map<string, MerchantGroup & { tally: Map<string, number> }>();
  for (const t of rows) {
    const direction: Direction = Number(t.amount) < 0 ? "out" : "in";
    const key = merchantKey(t.place) || "(sans libellé)";
    const id = `${direction}:${key}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        merchantKey: key,
        direction,
        label: t.place ?? "Sans libellé",
        count: 0,
        totalCents: 0,
        uncategorized: 0,
        currentCategoryId: null,
        proposedCategoryId: null,
        suggestedName: null,
        lastDate: t.date,
        tally: new Map(),
      };
      groups.set(id, g);
    }
    g.count++;
    g.totalCents += Number(t.amount);
    if (isUncategorized(t.categoryId)) g.uncategorized++;
    if (t.categoryId) g.tally.set(t.categoryId, (g.tally.get(t.categoryId) ?? 0) + 1);
  }

  const suggestionCounts = new Map<string, { count: number; examples: string[] }>();
  const result: MerchantGroup[] = [];
  for (const g of groups.values()) {
    const { tally, ...group } = g;
    group.currentCategoryId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    group.proposedCategoryId = categorizer.confidentCategoryFor(group.label, group.direction);
    if (!group.proposedCategoryId) {
      // catégorie manquante qui conviendrait (sens compris : une recette va dans une catégorie de revenu)
      const name = ruleCategoryNames(group.label).find((n) => {
        const suggested = SUGGESTED_CATEGORIES.find((c) => c.name === n);
        return suggested && !existing.has(categoryNameKey(n)) && suggested.isIncome === (group.direction === "in");
      });
      group.suggestedName = name ?? null;
      if (name && group.uncategorized) {
        const entry = suggestionCounts.get(name) ?? { count: 0, examples: [] };
        entry.count += group.uncategorized;
        if (entry.examples.length < 3) entry.examples.push(group.merchantKey);
        suggestionCounts.set(name, entry);
      }
    }
    result.push(group);
  }
  result.sort((a, b) => b.uncategorized - a.uncategorized || b.count - a.count);

  return {
    total: rows.length,
    uncategorized: rows.filter((t) => isUncategorized(t.categoryId)).length,
    groups: result,
    suggestions: SUGGESTED_CATEGORIES.filter((c) => suggestionCounts.has(c.name)).map((c) => ({ ...c, ...suggestionCounts.get(c.name)! })),
  };
}

/** Crée les catégories proposées retenues par l'utilisateur. */
export async function createSuggestedCategories(userId: string, names: string[]): Promise<number> {
  const wanted = SUGGESTED_CATEGORIES.filter((c) => names.includes(c.name));
  if (!wanted.length) return 0;
  const existing = await db.select({ name: s.categories.name, sort: s.categories.sort_order }).from(s.categories).where(eq(s.categories.user_id, userId));
  const taken = new Set(existing.map((c) => categoryNameKey(c.name)));
  let sort = Math.max(0, ...existing.map((c) => c.sort)) + 1;
  const rows = wanted
    .filter((c) => !taken.has(categoryNameKey(c.name)))
    .map((c) => ({ user_id: userId, name: c.name, icon: c.icon, color: c.color, is_income: c.isIncome, sort_order: sort++ }));
  if (rows.length) await db.insert(s.categories).values(rows);
  return rows.length;
}

/**
 * Classe les commerçants choisis : la catégorie est retenue pour le commerçant (apprentissage)
 * et appliquée à toutes ses lignes du même sens. Renvoie le nombre de lignes modifiées.
 */
export async function applyMerchantCategories(userId: string, items: { merchantKey: string; direction: Direction; categoryId: string }[]): Promise<number> {
  if (!items.length) return 0;
  const { active, rows } = await loadContext(userId);
  const valid = new Map(active.map((c) => [c.id, c]));
  const byGroup = new Map<string, string>();
  for (const it of items) {
    const cat = valid.get(it.categoryId);
    if (!cat) continue;
    byGroup.set(`${it.direction}:${it.merchantKey}`, cat.id);
  }
  const toUpdate = new Map<string, string[]>();
  for (const t of rows) {
    const id = `${Number(t.amount) < 0 ? "out" : "in"}:${merchantKey(t.place) || "(sans libellé)"}`;
    const categoryId = byGroup.get(id);
    if (!categoryId || t.categoryId === categoryId) continue;
    toUpdate.set(categoryId, [...(toUpdate.get(categoryId) ?? []), t.id]);
  }
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const [categoryId, ids] of toUpdate) {
      for (let i = 0; i < ids.length; i += 500) {
        const done = await tx
          .update(s.transactions)
          .set({ category_id: categoryId })
          .where(and(eq(s.transactions.user_id, userId), inArray(s.transactions.id, ids.slice(i, i + 500))))
          .returning({ id: s.transactions.id });
        changed += done.length;
      }
    }
    const r = s.merchantRules;
    for (const it of items) {
      const categoryId = byGroup.get(`${it.direction}:${it.merchantKey}`);
      if (!categoryId || it.merchantKey === "(sans libellé)") continue;
      await tx
        .insert(r)
        .values({ user_id: userId, merchant_key: it.merchantKey, category_id: categoryId })
        .onConflictDoUpdate({ target: [r.user_id, r.merchant_key], set: { category_id: categoryId, updated_at: new Date() } });
    }
  });
  return changed;
}

/** Nombre de lignes encore dans « Autres » ou sans catégorie (bandeau d'invitation). */
export async function countUncategorized(userId: string): Promise<number> {
  const autres = await db
    .select({ id: s.categories.id })
    .from(s.categories)
    .where(and(eq(s.categories.user_id, userId), sql`lower(${s.categories.name}) = 'autres'`));
  const t = s.transactions;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(
      and(
        eq(t.user_id, userId),
        inArray(t.type, ["in", "out"]),
        autres[0] ? or(isNull(t.category_id), eq(t.category_id, autres[0].id)) : isNull(t.category_id),
      ),
    );
  return Number(row?.n ?? 0);
}
