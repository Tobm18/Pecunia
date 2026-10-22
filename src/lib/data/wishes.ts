import "server-only";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/lib/db";
import { isValidIsoDate, monthKeyOf, monthPeriod, todayIso } from "@/lib/domain/dates";
import { buildForecast } from "@/lib/domain/forecast";
import { buildOccurrences, occurrenceWindow } from "@/lib/domain/recurrences";
import { wishMargin, wishStatuses, type WishMargin, type WishStatus } from "@/lib/domain/wishes";
import { getAppData, getForecastDecisions, getSession, getTransactions, getWishes } from "./queries";
import { getBudgetOverview } from "./views";

/**
 * Souhaits venant de G Koi À Faire (via src/app/api/integrations/wishes) : synchronisation de la
 * liste complète, puis rapport (marge du mois et état de chaque souhait). Toujours exécuté au nom
 * de l'utilisateur de la clé d'API (runAsUser), et filtré sur lui comme le reste de la couche.
 */

const SOURCE = "gkoi";

const wishInput = z.object({
  externalId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive().max(1_000_000_000),
  priority: z.enum(["high", "medium", "low"]).nullable().optional(),
  dueDate: z.string().refine(isValidIsoDate, "Date invalide.").nullable().optional(),
});
export const wishListInput = z.object({ wishes: z.array(wishInput).max(500) });
export type WishListInput = z.input<typeof wishListInput>;

/**
 * Remplace la liste des souhaits par celle reçue. Un souhait qui disparaît (fait ou abandonné dans
 * l'app d'origine) emporte sa ligne prévue non réalisée et ses refus ; une ligne déjà rapprochée
 * d'une vraie dépense reste (son lien au souhait est simplement remis à vide).
 */
export async function syncWishes(input: WishListInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = wishListInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Liste invalide." };
  const { user } = await getSession();
  const w = s.wishes;
  const incoming = new Map(parsed.data.wishes.map((x) => [x.externalId, x]));

  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: w.id, external_id: w.external_id }).from(w).where(and(eq(w.user_id, user.id), eq(w.source, SOURCE)));
    const removed = existing.filter((e) => !incoming.has(e.external_id)).map((e) => e.id);
    if (removed.length) {
      const f = s.forecastItems;
      await tx.delete(f).where(and(eq(f.user_id, user.id), inArray(f.wish_id, removed), eq(f.status, "planned")));
      const d = s.forecastDecisions;
      await tx.delete(d).where(and(eq(d.user_id, user.id), or(...removed.map((id) => like(d.source_key, `wish:${id}:%`)))));
      await tx.delete(w).where(and(eq(w.user_id, user.id), inArray(w.id, removed)));
    }
    for (const x of incoming.values()) {
      const values = { title: x.title, amount_cents: x.amountCents, priority: x.priority ?? null, due_date: x.dueDate ?? null, updated_at: new Date() };
      await tx
        .insert(w)
        .values({ user_id: user.id, source: SOURCE, external_id: x.externalId, ...values })
        .onConflictDoUpdate({ target: [w.user_id, w.source, w.external_id], set: values });
    }
  });
  return { ok: true };
}

export interface WishReport {
  /** Mois budgétaire en cours (« 2026-10 ») et ses bornes */
  month: string;
  period: { start: string; end: string };
  margin: WishMargin;
  wishes: WishStatus[];
}

/** Marge du mois et état de chaque souhait, d'après le prévisionnel du mois en cours. */
export async function wishReport(): Promise<WishReport> {
  const { profile, accounts, balances, recurrences, forecastItems } = await getAppData();
  const today = todayIso();
  const startDay = profile.monthStartDay;
  const current = monthKeyOf(today, startDay);
  const period = monthPeriod(current, startDay);
  const range = occurrenceWindow(period.start, period.end);
  const [txs, budgets, decisions, wishes] = await Promise.all([
    getTransactions({ from: range.from, to: range.to }),
    getBudgetOverview(current),
    getForecastDecisions(current),
    getWishes(),
  ]);
  const active = accounts.filter((a) => !a.archivedAt);
  const {
    months: [month],
  } = buildForecast({
    accounts,
    balances: Object.fromEntries(active.map((a) => [a.id, balances.get(a.id)?.balanceCents ?? a.initialBalanceCents])),
    today,
    horizon: 1,
    startDay,
    // comme la page Prévisionnel : transactions sur la fenêtre élargie, échéances sur le mois
    occurrences: buildOccurrences(recurrences, txs, period.start, period.end),
    forecastItems,
    decisions,
    budgets,
    wishes,
  });

  // dépenses réelles rapprochées des souhaits (montant réellement payé)
  const linkedIds = forecastItems.filter((f) => f.wishId && f.linkedTransactionId).map((f) => f.linkedTransactionId!);
  const { user } = await getSession();
  const linked = linkedIds.length
    ? await db
        .select({ id: s.transactions.id, amountCents: s.transactions.amount_cents, date: s.transactions.date })
        .from(s.transactions)
        .where(and(eq(s.transactions.user_id, user.id), inArray(s.transactions.id, linkedIds)))
    : [];

  return {
    month: current,
    period,
    margin: wishMargin(month!, accounts, profile.wishCushionCents),
    wishes: wishStatuses({
      wishes,
      forecastItems,
      decisions,
      transactions: linked.map((t) => ({ ...t, amountCents: Number(t.amountCents) })),
      currentMonth: current,
    }),
  };
}
