import "server-only";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { CONFIDENCE, merchantKey } from "@/lib/domain/categorize";
import { allocateRent, type RentMode } from "@/lib/domain/rent";

/**
 * Loyer payé à un proche. Les règles s'appliquent à chaque passage du classement automatique :
 * les parts détachées précédentes sont d'abord recollées à leur virement, puis recalculées (une
 * règle modifiée ou un nouveau virement sont ainsi toujours pris en compte). Le total d'un
 * virement et de sa part loyer est toujours son montant d'origine.
 */

export const RENT_NOTE = "Part loyer";

export interface RentRuleView {
  id: string;
  merchantKey: string;
  mode: RentMode;
  value: number;
  categoryId: string;
  /** Virements concernés et total compté en loyer */
  transfers: number;
  rentCents: number;
}

export interface Recipient {
  merchantKey: string;
  label: string;
  count: number;
  totalCents: number;
}

/** Recolle les parts loyer à leur virement et rend au classement les virements entièrement en loyer. */
async function restoreSplits(userId: string, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const t = s.transactions;
  await tx.execute(sql`
    update ${t} p set amount_cents = p.amount_cents + c.total
    from (select split_of, sum(amount_cents) as total from ${t} where user_id = ${userId} and split_of is not null group by split_of) c
    where p.id = c.split_of and p.user_id = ${userId}`);
  await tx.delete(t).where(and(eq(t.user_id, userId), isNotNull(t.split_of)));
  await tx
    .update(t)
    .set({ category_source: null, category_confidence: null, rent_rule_id: null })
    .where(and(eq(t.user_id, userId), eq(t.category_source, "rent")));
}

/** Applique toutes les règles de loyer de l'utilisateur. Renvoie le nombre de virements concernés. */
export async function applyRentRules(userId: string): Promise<number> {
  const t = s.transactions;
  const rules = await db.select().from(s.rentRules).where(eq(s.rentRules.user_id, userId));
  // parts existantes (y compris celles d'une règle qui vient d'être supprimée) : à recoller
  const hasSplits = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.user_id, userId), or(isNotNull(t.split_of), eq(t.category_source, "rent"))))
    .limit(1);
  if (!rules.length && !hasSplits.length) return 0;

  let touched = 0;
  await db.transaction(async (tx) => {
    await restoreSplits(userId, tx);
    if (!rules.length) return;
    const rows = await tx
      .select({ id: t.id, place: t.place, amount: t.amount_cents, date: t.date, accountId: t.account_id })
      .from(t)
      .where(and(eq(t.user_id, userId), eq(t.type, "out"), isNull(t.split_of)));
    for (const rule of rules) {
      const lines = rows.filter((r) => merchantKey(r.place) === rule.merchant_key);
      const parts = allocateRent(
        lines.map((l) => ({ id: l.id, date: l.date, cents: -Number(l.amount) })),
        { mode: rule.mode, value: rule.value },
      );
      for (const line of lines) {
        const part = parts.get(line.id);
        if (!part) continue;
        touched++;
        const amount = Number(line.amount);
        if (part >= -amount) {
          // tout le virement est du loyer : la ligne change simplement de catégorie
          await tx
            .update(t)
            .set({ category_id: rule.category_id, category_source: "rent", category_confidence: CONFIDENCE.manual, rent_rule_id: rule.id })
            .where(eq(t.id, line.id));
          continue;
        }
        await tx.update(t).set({ amount_cents: amount + part }).where(eq(t.id, line.id));
        await tx.insert(t).values({
          user_id: userId,
          account_id: line.accountId,
          type: "out",
          amount_cents: -part,
          date: line.date,
          place: line.place,
          note: RENT_NOTE,
          category_id: rule.category_id,
          category_source: "rent",
          category_confidence: CONFIDENCE.manual,
          split_of: line.id,
          rent_rule_id: rule.id,
        });
      }
    }
  });
  return touched;
}

export async function listRentRules(userId: string): Promise<RentRuleView[]> {
  const t = s.transactions;
  const [rules, stats] = await Promise.all([
    db.select().from(s.rentRules).where(eq(s.rentRules.user_id, userId)),
    db
      .select({ ruleId: t.rent_rule_id, n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${t.amount_cents}), 0)` })
      .from(t)
      .where(and(eq(t.user_id, userId), isNotNull(t.rent_rule_id)))
      .groupBy(t.rent_rule_id),
  ]);
  const byRule = new Map(stats.map((x) => [x.ruleId, x]));
  return rules.map((r) => ({
    id: r.id,
    merchantKey: r.merchant_key,
    mode: r.mode,
    value: r.value,
    categoryId: r.category_id,
    transfers: Number(byRule.get(r.id)?.n ?? 0),
    rentCents: -Number(byRule.get(r.id)?.total ?? 0),
  }));
}

/** Proches à qui l'utilisateur fait des virements (Wero, virements nominatifs), les plus fréquents d'abord. */
export async function listRecipients(userId: string): Promise<Recipient[]> {
  const t = s.transactions;
  const rows = await db
    .select({ place: t.place, amount: t.amount_cents })
    .from(t)
    .where(and(eq(t.user_id, userId), inArray(t.type, ["out"]), isNull(t.split_of)));
  const byKey = new Map<string, Recipient>();
  for (const r of rows) {
    const key = merchantKey(r.place);
    if (!/^(vir|wero) /.test(key)) continue;
    const entry = byKey.get(key) ?? { merchantKey: key, label: r.place ?? key, count: 0, totalCents: 0 };
    entry.count++;
    entry.totalCents += Number(r.amount);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 40);
}

export async function saveRentRule(userId: string, input: { merchantKey: string; mode: RentMode; value: number; categoryId: string }): Promise<void> {
  const [category] = await db
    .select({ id: s.categories.id })
    .from(s.categories)
    .where(and(eq(s.categories.id, input.categoryId), eq(s.categories.user_id, userId)));
  if (!category) throw new Error("catégorie inconnue");
  const r = s.rentRules;
  await db
    .insert(r)
    .values({ user_id: userId, merchant_key: input.merchantKey, mode: input.mode, value: input.value, category_id: category.id })
    .onConflictDoUpdate({ target: [r.user_id, r.merchant_key], set: { mode: input.mode, value: input.value, category_id: category.id } });
  await applyRentRules(userId);
}

export async function deleteRentRule(userId: string, ruleId: string): Promise<void> {
  await db.delete(s.rentRules).where(and(eq(s.rentRules.id, ruleId), eq(s.rentRules.user_id, userId)));
  // recolle les parts de la règle supprimée et réapplique les autres
  await applyRentRules(userId);
}
