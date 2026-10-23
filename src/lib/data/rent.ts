import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { CONFIDENCE, merchantKey } from "@/lib/domain/categorize";
import { allocateRent, isUnnamedTransfer, matchesRecipient, recipientName, type RentMode, type RentPeriod } from "@/lib/domain/rent";

/**
 * Loyer payé à un proche. Une règle (proche + catégorie) a un historique de périodes : chacune fixe
 * la part de loyer à partir d'une date. Les règles s'appliquent à chaque passage du classement
 * automatique : les parts détachées précédentes sont d'abord recollées à leur virement, puis
 * recalculées (période ajoutée, montant corrigé ou nouveau virement sont ainsi toujours pris en
 * compte). Le total d'un virement et de sa part loyer est toujours son montant d'origine.
 */

/** Lendemain d'une date ISO */
const dayAfter = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export interface RentPeriodView extends RentPeriod {
  id: string;
}

export interface RentRuleView {
  id: string;
  merchantKey: string;
  categoryId: string;
  /** Dernier jour où la règle s'applique (null : sans fin) */
  endDate: string | null;
  periods: RentPeriodView[];
  /** Virements concernés et total compté en loyer */
  transfers: number;
  rentCents: number;
  /** Premier et dernier virement au proche, pour situer les périodes */
  firstTransfer: string | null;
  lastTransfer: string | null;
  /** Variantes du nom reconnues (la banque le tronque : « vir chou », « vir chouc »…) */
  aliases: string[];
}

export interface Recipient {
  merchantKey: string;
  label: string;
  count: number;
  totalCents: number;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Recolle les parts loyer à leur virement et rend au classement les virements entièrement en loyer. */
async function restoreSplits(userId: string, tx: Tx) {
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

async function periodsByRule(userId: string): Promise<Map<string, RentPeriodView[]>> {
  const rows = await db.select().from(s.rentPeriods).where(eq(s.rentPeriods.user_id, userId)).orderBy(asc(s.rentPeriods.start_date));
  const map = new Map<string, RentPeriodView[]>();
  for (const p of rows) map.set(p.rule_id, [...(map.get(p.rule_id) ?? []), { id: p.id, start: p.start_date, mode: p.mode, value: p.value }]);
  return map;
}

/** Applique toutes les règles de loyer de l'utilisateur. Renvoie le nombre de virements concernés. */
export async function applyRentRules(userId: string): Promise<number> {
  const t = s.transactions;
  const [rules, periods, categories, hasSplits] = await Promise.all([
    db.select().from(s.rentRules).where(eq(s.rentRules.user_id, userId)),
    periodsByRule(userId),
    db.select({ id: s.categories.id, name: s.categories.name }).from(s.categories).where(eq(s.categories.user_id, userId)),
    // parts existantes (y compris celles d'une règle qui vient d'être supprimée) : à recoller
    db
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.user_id, userId), or(isNotNull(t.split_of), eq(t.category_source, "rent"))))
      .limit(1),
  ]);
  if (!rules.length && !hasSplits.length) return 0;

  let touched = 0;
  await db.transaction(async (tx) => {
    // un seul passage à la fois par utilisateur : deux passages simultanés recolleraient et
    // redécouperaient les mêmes virements l'un sur l'autre (parts perdues ou dupliquées)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`rent:${userId}`}, 0))`);
    await restoreSplits(userId, tx);
    if (!rules.length) return;
    const rows = (
      await tx
        .select({ id: t.id, place: t.place, amount: t.amount_cents, date: t.date, accountId: t.account_id })
        .from(t)
        .where(and(eq(t.user_id, userId), eq(t.type, "out"), isNull(t.split_of)))
    ).map((r) => ({ ...r, key: merchantKey(r.place) }));
    // un virement ne compte que pour une règle (un virement sans nom peut correspondre à plusieurs)
    const claimed = new Set<string>();
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    for (const rule of rules) {
      const end = rule.end_date;
      const lines = rows.filter(
        (r) => !claimed.has(r.id) && (!end || r.date <= end) && (matchesRecipient(rule.merchant_key, r.key) || isUnnamedTransfer(r.key)),
      );
      // après la date de fin, plus rien n'est dû (pas de paiement d'avance au-delà)
      const rulePeriods = [...(periods.get(rule.id) ?? []), ...(end ? [{ start: dayAfter(end), mode: "monthly" as const, value: 0 }] : [])];
      const parts = allocateRent(
        lines.map((l) => ({ id: l.id, date: l.date, cents: -Number(l.amount), unnamed: isUnnamedTransfer(l.key) })),
        rulePeriods,
      );
      const note = `Part ${categoryName.get(rule.category_id) ?? "réservée"}`;
      for (const line of lines) {
        const part = parts.get(line.id);
        if (!part) continue;
        claimed.add(line.id);
        touched++;
        const amount = Number(line.amount);
        if (part >= -amount) {
          // tout le virement est du loyer : la ligne change simplement de catégorie
          await tx
            .update(t)
            .set({ category_id: rule.category_id, category_source: "rent", category_confidence: CONFIDENCE.rent, rent_rule_id: rule.id })
            .where(eq(t.id, line.id));
          continue;
        }
        // modification relative : jamais de montant réécrit à partir d'une lecture
        await tx
          .update(t)
          .set({ amount_cents: sql`${t.amount_cents} + ${part}` })
          .where(eq(t.id, line.id));
        await tx.insert(t).values({
          user_id: userId,
          account_id: line.accountId,
          type: "out",
          amount_cents: -part,
          date: line.date,
          place: line.place,
          note,
          category_id: rule.category_id,
          category_source: "rent",
          category_confidence: CONFIDENCE.rent,
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
  const [rules, periods, stats, rows] = await Promise.all([
    db.select().from(s.rentRules).where(eq(s.rentRules.user_id, userId)).orderBy(asc(s.rentRules.created_at)),
    periodsByRule(userId),
    db
      .select({ ruleId: t.rent_rule_id, n: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${t.amount_cents}), 0)` })
      .from(t)
      .where(and(eq(t.user_id, userId), isNotNull(t.rent_rule_id)))
      .groupBy(t.rent_rule_id),
    db
      .select({ place: t.place, date: t.date })
      .from(t)
      .where(and(eq(t.user_id, userId), eq(t.type, "out"), isNull(t.split_of))),
  ]);
  const byRule = new Map(stats.map((x) => [x.ruleId, x]));
  return rules.map((r) => {
    const matched = rows.filter((x) => matchesRecipient(r.merchant_key, merchantKey(x.place)));
    const dates = matched.map((x) => x.date).sort();
    return {
      aliases: [...new Set(matched.map((x) => merchantKey(x.place)))].sort(),
      id: r.id,
      merchantKey: r.merchant_key,
      categoryId: r.category_id,
      endDate: r.end_date,
      periods: periods.get(r.id) ?? [],
      transfers: Number(byRule.get(r.id)?.n ?? 0),
      rentCents: -Number(byRule.get(r.id)?.total ?? 0),
      firstTransfer: dates[0] ?? null,
      lastTransfer: dates.at(-1) ?? null,
    };
  });
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
  // variantes tronquées d'un même nom (« vir chou », « vir chouchounne ») réunies sous le plus long
  const groups: Recipient[] = [];
  for (const r of [...byKey.values()].sort((a, b) => recipientName(b.merchantKey).length - recipientName(a.merchantKey).length)) {
    const group = groups.find((g) => g.merchantKey.split(" ")[0] === r.merchantKey.split(" ")[0] && matchesRecipient(g.merchantKey, r.merchantKey));
    if (group) {
      group.count += r.count;
      group.totalCents += r.totalCents;
    } else groups.push({ ...r });
  }
  return groups.sort((a, b) => b.count - a.count).slice(0, 40);
}

async function ownedCategory(userId: string, categoryId: string) {
  const [category] = await db
    .select({ id: s.categories.id })
    .from(s.categories)
    .where(and(eq(s.categories.id, categoryId), eq(s.categories.user_id, userId)));
  if (!category) throw new Error("catégorie inconnue");
  return category.id;
}

/** Nouvelle règle (proche + catégorie) avec sa première période. */
export async function createRentRule(
  userId: string,
  input: { merchantKey: string; categoryId: string; period: RentPeriod; endDate: string | null },
): Promise<void> {
  const categoryId = await ownedCategory(userId, input.categoryId);
  await db.transaction(async (tx) => {
    const r = s.rentRules;
    const [rule] = await tx
      .insert(r)
      .values({ user_id: userId, merchant_key: input.merchantKey, category_id: categoryId, end_date: input.endDate })
      .onConflictDoUpdate({ target: [r.user_id, r.merchant_key], set: { category_id: categoryId, end_date: input.endDate } })
      .returning({ id: r.id });
    await upsertPeriod(tx, userId, rule!.id, input.period);
  });
  await applyRentRules(userId);
}

async function upsertPeriod(tx: Tx, userId: string, ruleId: string, period: RentPeriod) {
  const p = s.rentPeriods;
  await tx
    .insert(p)
    .values({ rule_id: ruleId, user_id: userId, start_date: period.start, mode: period.mode, value: period.value })
    .onConflictDoUpdate({ target: [p.rule_id, p.start_date], set: { mode: period.mode, value: period.value } });
}

/** Ajoute (ou remplace, à la même date) une période d'une règle. */
export async function addRentPeriod(userId: string, ruleId: string, period: RentPeriod): Promise<void> {
  const [rule] = await db
    .select({ id: s.rentRules.id })
    .from(s.rentRules)
    .where(and(eq(s.rentRules.id, ruleId), eq(s.rentRules.user_id, userId)));
  if (!rule) throw new Error("règle inconnue");
  await db.transaction((tx) => upsertPeriod(tx, userId, rule.id, period));
  await applyRentRules(userId);
}

/** Retire une période (la précédente s'applique alors jusqu'à la suivante). */
export async function deleteRentPeriod(userId: string, periodId: string): Promise<void> {
  await db.delete(s.rentPeriods).where(and(eq(s.rentPeriods.id, periodId), eq(s.rentPeriods.user_id, userId)));
  await applyRentRules(userId);
}

/** Date de fin d'une règle (null : sans fin). */
export async function setRentEnd(userId: string, ruleId: string, endDate: string | null): Promise<void> {
  await db
    .update(s.rentRules)
    .set({ end_date: endDate })
    .where(and(eq(s.rentRules.id, ruleId), eq(s.rentRules.user_id, userId)));
  await applyRentRules(userId);
}

export async function setRentCategory(userId: string, ruleId: string, categoryId: string): Promise<void> {
  const id = await ownedCategory(userId, categoryId);
  await db
    .update(s.rentRules)
    .set({ category_id: id })
    .where(and(eq(s.rentRules.id, ruleId), eq(s.rentRules.user_id, userId)));
  await applyRentRules(userId);
}

export async function deleteRentRule(userId: string, ruleId: string): Promise<void> {
  await db.delete(s.rentRules).where(and(eq(s.rentRules.id, ruleId), eq(s.rentRules.user_id, userId)));
  // recolle les parts de la règle supprimée et réapplique les autres
  await applyRentRules(userId);
}
