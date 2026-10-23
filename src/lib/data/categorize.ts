import "server-only";
import { and, desc, eq, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import {
  categoryNameKey,
  CONFIDENCE,
  directoryKey,
  isCardPayment,
  merchantKey,
  merchantPlace,
  needsReview,
  REVIEW_BELOW,
  ruleCategoryNames,
  SOURCE_LABELS,
  SUGGESTED_CATEGORIES,
  type CategorySource,
  type SuggestedCategory,
} from "@/lib/domain/categorize";
import { createCategorizer, type DirectoryHits } from "@/lib/domain/csv-import";
import { lookupMerchant } from "@/lib/directory";
import { applyRentRules } from "./rent";
import { toCategory } from "./mappers";

/**
 * Classement automatique des transactions (sans IA). Chaque dépense / recette non choisie à la
 * main reçoit une catégorie, une origine et un score de confiance : règle apprise de tes choix,
 * mot-clé, ou activité du commerçant dans l'annuaire des entreprises (cherchée automatiquement,
 * une fois par commerçant). Sous le seuil, la ligne est « à vérifier ». Une catégorie manuelle
 * (saisie, modifiée ou validée) n'est jamais recalculée. Toujours filtré sur l'utilisateur.
 */

export type Direction = "out" | "in";

/** Retient la catégorie d'un commerçant : elle vaudra pour toutes ses lignes automatiques. */
export async function learnMerchant(userId: string, label: string | null, categoryId: string): Promise<void> {
  const key = merchantKey(label);
  if (!key) return;
  const r = s.merchantRules;
  await db
    .insert(r)
    .values({ user_id: userId, merchant_key: key, category_id: categoryId })
    .onConflictDoUpdate({ target: [r.user_id, r.merchant_key], set: { category_id: categoryId, updated_at: new Date() } });
}

async function loadCategorizer(userId: string) {
  const [categories, learned, directory] = await Promise.all([
    // catégories, règles apprises et cache de l'annuaire
    db.select().from(s.categories).where(eq(s.categories.user_id, userId)),
    db
      .select({ merchantKey: s.merchantRules.merchant_key, categoryId: s.merchantRules.category_id })
      .from(s.merchantRules)
      .where(eq(s.merchantRules.user_id, userId)),
    db.select({ key: s.merchantDirectory.lookup_key, naf: s.merchantDirectory.naf, score: s.merchantDirectory.score }).from(s.merchantDirectory),
  ]);
  const cats = categories.map(toCategory);
  const hits: DirectoryHits = new Map(directory.map((d) => [d.key, { naf: d.naf, score: d.score }]));
  // pas de « mémoire des lieux » : elle répéterait les classements automatiques eux-mêmes ;
  // les choix manuels passent par les règles apprises
  return { cats, hits, learned, categorizer: createCategorizer(cats, [], learned, hits) };
}

/** Lignes automatiques d'un utilisateur : ni manuelles, ni comptées en loyer (règle de loyer). */
function automaticRows(userId: string) {
  const t = s.transactions;
  return db
    .select({ id: t.id, place: t.place, amount: t.amount_cents, categoryId: t.category_id, source: t.category_source, confidence: t.category_confidence })
    .from(t)
    .where(
      and(
        eq(t.user_id, userId),
        inArray(t.type, ["in", "out"]),
        isNull(t.split_of),
        or(isNull(t.category_source), notInArray(t.category_source, ["manual", "rent"])),
      ),
    );
}

/** Recherches dans l'annuaire, quelques-unes à la fois (l'API limite le débit). */
async function lookupMany(places: { key: string; place: NonNullable<ReturnType<typeof merchantPlace>> }[]): Promise<number> {
  let done = 0;
  const queue = [...places];
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        const r = await lookupMerchant(next.place);
        await db
          .insert(s.merchantDirectory)
          .values({ lookup_key: next.key, name: r.name, commune: r.commune, naf: r.naf, score: r.score })
          .onConflictDoUpdate({ target: s.merchantDirectory.lookup_key, set: { name: r.name, commune: r.commune, naf: r.naf, score: r.score, looked_up_at: new Date() } });
        done++;
      } catch {
        // annuaire indisponible ou limite atteinte : on réessaiera au prochain passage
        if (queue.length) await new Promise((r) => setTimeout(r, 1000));
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return done;
}

/**
 * Passage automatique : cherche dans l'annuaire les commerçants encore incertains (au plus
 * `lookupBudget` par passage), puis reclasse toutes les lignes automatiques. Une ligne d'origine
 * inconnue (« legacy », d'avant le classement automatique) garde sa catégorie si le nouveau
 * classement n'est pas plus sûr, marquée à vérifier.
 */
export async function autoCategorize(userId: string, { lookupBudget = 150 } = {}): Promise<{ updated: number; lookedUp: number; toReview: number }> {
  // loyer payé à un proche : parts détachées d'abord, elles ne sont pas reclassées ensuite
  await applyRentRules(userId);
  let { cats, hits, categorizer } = await loadCategorizer(userId);
  const rows = await automaticRows(userId);
  const autres = cats.find((c) => !c.archivedAt && categoryNameKey(c.name) === "autres")?.id ?? null;

  // 1. annuaire : commerçants payés par carte, sans classement sûr, jamais cherchés
  const wanted = new Map<string, NonNullable<ReturnType<typeof merchantPlace>>>();
  for (const r of rows) {
    if (wanted.size >= lookupBudget) break;
    if (Number(r.amount) >= 0 || !isCardPayment(r.place)) continue;
    const place = merchantPlace(r.place);
    if (!place || hits.has(directoryKey(place)) || wanted.has(directoryKey(place))) continue;
    if (categorizer.classify(r.place ?? "", "out").confidence >= REVIEW_BELOW) continue;
    wanted.set(directoryKey(place), place);
  }
  let lookedUp = 0;
  if (wanted.size) {
    lookedUp = await lookupMany([...wanted].map(([key, place]) => ({ key, place })));
    ({ cats, hits, categorizer } = await loadCategorizer(userId));
  }

  // 2. reclassement des lignes automatiques
  const updates = new Map<string, { categoryId: string | null; source: CategorySource; confidence: number; ids: string[] }>();
  let toReview = 0;
  for (const r of rows) {
    const direction: Direction = Number(r.amount) < 0 ? "out" : "in";
    let next = categorizer.classify(r.place ?? "", direction);
    if (r.source === "legacy" && r.categoryId && r.categoryId !== autres && next.categoryId !== r.categoryId && next.confidence < CONFIDENCE.learned) {
      next = { categoryId: r.categoryId, source: "legacy", confidence: CONFIDENCE.legacy };
    }
    if (needsReview(next.source, next.confidence)) toReview++;
    if (next.categoryId === r.categoryId && next.source === r.source && next.confidence === r.confidence) continue;
    const k = `${next.categoryId}|${next.source}|${next.confidence}`;
    const entry = updates.get(k) ?? { ...next, ids: [] };
    entry.ids.push(r.id);
    updates.set(k, entry);
  }
  let updated = 0;
  const t = s.transactions;
  for (const u of updates.values()) {
    for (let i = 0; i < u.ids.length; i += 500) {
      const done = await db
        .update(t)
        .set({ category_id: u.categoryId, category_source: u.source, category_confidence: u.confidence })
        // jamais une ligne passée en manuel entre-temps
        .where(and(eq(t.user_id, userId), inArray(t.id, u.ids.slice(i, i + 500)), or(isNull(t.category_source), ne(t.category_source, "manual"))))
        .returning({ id: t.id });
      updated += done.length;
    }
  }
  return { updated, lookedUp, toReview };
}

/** Tâche quotidienne : passage automatique pour chaque utilisateur. */
export async function autoCategorizeAll(): Promise<{ users: number; updated: number; lookedUp: number }> {
  const users = await db.select({ id: s.user.id }).from(s.user);
  let updated = 0;
  let lookedUp = 0;
  for (const u of users) {
    const r = await autoCategorize(u.id).catch(() => ({ updated: 0, lookedUp: 0 }));
    updated += r.updated;
    lookedUp += r.lookedUp;
  }
  return { users: users.length, updated, lookedUp };
}

// ---------------------------------------------------------------------------
// Lignes à vérifier
// ---------------------------------------------------------------------------

export interface ReviewGroup {
  /** Clé commerçant + sens : un même commerçant peut avoir des dépenses et des recettes */
  id: string;
  merchantKey: string;
  direction: Direction;
  label: string;
  count: number;
  totalCents: number;
  /** Catégorie automatique actuelle (la plus fréquente du groupe) */
  categoryId: string | null;
  confidence: number;
  sourceLabel: string;
  /** Catégorie à créer qui conviendrait, quand aucune existante ne convient */
  suggestedName: string | null;
  lastDate: string;
  /** Opérations du groupe, les plus récentes d'abord (au plus REVIEW_LINES), pour s'en souvenir */
  lines: { date: string; label: string; cents: number; accountId: string; note: string | null }[];
}

/** Opérations détaillées par commerçant à vérifier */
const REVIEW_LINES = 30;

export interface ReviewOverview {
  total: number;
  toReview: number;
  groups: ReviewGroup[];
  /** Catégories proposées à la création, avec le nombre de lignes à vérifier qu'elles classeraient */
  suggestions: (SuggestedCategory & { count: number; examples: string[] })[];
}

/** Lignes à vérifier, regroupées par commerçant, et catégories manquantes. */
export async function getReviewOverview(userId: string): Promise<ReviewOverview> {
  const t = s.transactions;
  const [categories, rows, [total]] = await Promise.all([
    db.select().from(s.categories).where(eq(s.categories.user_id, userId)),
    db
      .select({
        place: t.place,
        amount: t.amount_cents,
        date: t.date,
        accountId: t.account_id,
        note: t.note,
        categoryId: t.category_id,
        source: t.category_source,
        confidence: t.category_confidence,
      })
      .from(t)
      .where(and(eq(t.user_id, userId), inArray(t.type, ["in", "out"]), ne(t.category_source, "manual"), lt(t.category_confidence, REVIEW_BELOW)))
      .orderBy(desc(t.date)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.user_id, userId), inArray(t.type, ["in", "out"]))),
  ]);
  const existing = new Set(categories.filter((c) => !c.archived_at).map((c) => categoryNameKey(c.name)));

  const groups = new Map<string, ReviewGroup & { tally: Map<string, number> }>();
  for (const r of rows) {
    const direction: Direction = Number(r.amount) < 0 ? "out" : "in";
    const key = merchantKey(r.place) || "(sans libellé)";
    const id = `${direction}:${key}`;
    let g = groups.get(id);
    if (!g) {
      g = {
        id,
        merchantKey: key,
        direction,
        label: r.place ?? "Sans libellé",
        count: 0,
        totalCents: 0,
        categoryId: null,
        confidence: r.confidence ?? 0,
        sourceLabel: SOURCE_LABELS[(r.source as CategorySource) ?? "fallback"] ?? "",
        suggestedName: null,
        lastDate: r.date,
        lines: [],
        tally: new Map(),
      };
      groups.set(id, g);
    }
    g.count++;
    g.totalCents += Number(r.amount);
    g.confidence = Math.min(g.confidence, r.confidence ?? 0);
    // lignes triées par date décroissante : les premières vues sont les plus récentes
    if (g.lines.length < REVIEW_LINES) {
      g.lines.push({ date: r.date, label: r.place ?? "Sans libellé", cents: Number(r.amount), accountId: r.accountId, note: r.note });
    }
    if (r.categoryId) g.tally.set(r.categoryId, (g.tally.get(r.categoryId) ?? 0) + 1);
  }

  const suggestionCounts = new Map<string, { count: number; examples: string[] }>();
  const result: ReviewGroup[] = [];
  for (const g of groups.values()) {
    const { tally, ...group } = g;
    group.categoryId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const name = ruleCategoryNames(group.label).find((n) => {
      const suggested = SUGGESTED_CATEGORIES.find((c) => c.name === n);
      return suggested && !existing.has(categoryNameKey(n)) && suggested.isIncome === (group.direction === "in");
    });
    group.suggestedName = name ?? null;
    if (name) {
      const entry = suggestionCounts.get(name) ?? { count: 0, examples: [] };
      entry.count += group.count;
      if (entry.examples.length < 3) entry.examples.push(group.merchantKey);
      suggestionCounts.set(name, entry);
    }
    result.push(group);
  }
  result.sort((a, b) => b.count - a.count || a.confidence - b.confidence);

  return {
    total: Number(total?.n ?? 0),
    toReview: rows.length,
    groups: result,
    suggestions: SUGGESTED_CATEGORIES.filter((c) => suggestionCounts.has(c.name)).map((c) => ({ ...c, ...suggestionCounts.get(c.name)! })),
  };
}

/** Lignes pas encore passées par le classement automatique (nouvelles, ou d'avant ce classement). */
export async function countUnprocessed(userId: string): Promise<number> {
  const t = s.transactions;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.user_id, userId), inArray(t.type, ["in", "out"]), or(isNull(t.category_source), eq(t.category_source, "legacy"))));
  return Number(row?.n ?? 0);
}

/** Nombre de lignes à vérifier (bandeaux d'invitation). */
export async function countToReview(userId: string): Promise<number> {
  const t = s.transactions;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(eq(t.user_id, userId), inArray(t.type, ["in", "out"]), ne(t.category_source, "manual"), lt(t.category_confidence, REVIEW_BELOW)));
  return Number(row?.n ?? 0);
}

/** Crée les catégories proposées retenues par l'utilisateur, puis reclasse. */
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
 * Validation d'un commerçant (lignes à vérifier) : la catégorie est retenue pour lui
 * (apprentissage) et appliquée à toutes ses lignes automatiques du même sens, qui passent en
 * « manuel ». Renvoie le nombre de lignes modifiées.
 */
export async function validateMerchants(userId: string, items: { merchantKey: string; direction: Direction; categoryId: string }[]): Promise<number> {
  if (!items.length) return 0;
  const categories = await db.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.user_id, userId));
  const valid = new Set(categories.map((c) => c.id));
  const byGroup = new Map(items.filter((i) => valid.has(i.categoryId)).map((i) => [`${i.direction}:${i.merchantKey}`, i.categoryId]));
  const rows = await automaticRows(userId);
  const toUpdate = new Map<string, string[]>();
  for (const r of rows) {
    const categoryId = byGroup.get(`${Number(r.amount) < 0 ? "out" : "in"}:${merchantKey(r.place) || "(sans libellé)"}`);
    if (!categoryId) continue;
    toUpdate.set(categoryId, [...(toUpdate.get(categoryId) ?? []), r.id]);
  }
  let changed = 0;
  const t = s.transactions;
  await db.transaction(async (tx) => {
    for (const [categoryId, ids] of toUpdate) {
      for (let i = 0; i < ids.length; i += 500) {
        const done = await tx
          .update(t)
          .set({ category_id: categoryId, category_source: "manual", category_confidence: CONFIDENCE.manual })
          .where(and(eq(t.user_id, userId), inArray(t.id, ids.slice(i, i + 500))))
          .returning({ id: t.id });
        changed += done.length;
      }
    }
    const r = s.merchantRules;
    for (const [group, categoryId] of byGroup) {
      const key = group.slice(group.indexOf(":") + 1);
      if (key === "(sans libellé)") continue;
      await tx
        .insert(r)
        .values({ user_id: userId, merchant_key: key, category_id: categoryId })
        .onConflictDoUpdate({ target: [r.user_id, r.merchant_key], set: { category_id: categoryId, updated_at: new Date() } });
    }
  });
  return changed;
}

/** Une ligne précise : catégorie confirmée telle quelle (elle n'est plus à vérifier). */
export async function confirmTransactionCategory(userId: string, transactionId: string): Promise<boolean> {
  const t = s.transactions;
  const [row] = await db
    .update(t)
    .set({ category_source: "manual", category_confidence: CONFIDENCE.manual })
    .where(and(eq(t.id, transactionId), eq(t.user_id, userId), inArray(t.type, ["in", "out"])))
    .returning({ place: t.place, categoryId: t.category_id });
  if (row?.categoryId) await learnMerchant(userId, row.place, row.categoryId);
  return !!row;
}
