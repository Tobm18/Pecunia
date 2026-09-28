/**
 * Agrégats du tableau de bord, des comptes et des analyses.
 *
 * RÈGLE STRUCTURANTE : les virements (type « transfer ») ne comptent JAMAIS dans les
 * dépenses, les revenus, les budgets ni le taux d'épargne. Les régularisations
 * (« adjust ») non plus : elles corrigent un solde, ce ne sont pas des mouvements réels.
 * Seuls « out » (dépenses) et « in » / « interest » (revenus) entrent dans ces calculs.
 */
import type { Account, Transaction } from "./types";
import { monthKeyOf, type IsoDate, type MonthKey } from "./dates";

export const isExpense = (t: Transaction) => t.type === "out";
export const isIncome = (t: Transaction) => t.type === "in" || t.type === "interest";

/** Transactions d'un compte (ou toutes si accountId est null). */
export function filterByAccount(txs: Transaction[], accountId: string | null): Transaction[] {
  return accountId ? txs.filter((t) => t.accountId === accountId) : txs;
}

export interface MonthSummary {
  incomeCents: number;
  /** Positif */
  expenseCents: number;
  /** revenus − dépenses */
  netCents: number;
  interestCents: number;
  /** Virements nets vers l'épargne + intérêts */
  savedCents: number;
  /** transferts vers l'épargne seulement (sous-texte du KPI) */
  savingsTransfersCents: number;
  /** net / revenus, null si aucun revenu */
  savingsRate: number | null;
}

/**
 * KPI d'une période. `txs` doit déjà être restreint à la période ; `accountId` filtre
 * sur un compte (null = « Tous »).
 */
export function summarize(
  txs: Transaction[],
  accounts: Account[],
  accountId: string | null = null,
): MonthSummary {
  const accountType = new Map(accounts.map((a) => [a.id, a.type]));
  let incomeCents = 0;
  let expenseCents = 0;
  let interestCents = 0;
  let savingsTransfersCents = 0;

  for (const t of txs) {
    const own = accountId === null || t.accountId === accountId;
    if (own && isExpense(t)) expenseCents += -t.amountCents;
    if (own && isIncome(t)) incomeCents += t.amountCents;
    if (own && t.type === "interest") interestCents += t.amountCents;

    // Épargne : on regarde la ligne côté compte d'épargne d'un virement venant
    // (ou repartant) d'un compte non-épargne. Épargne → épargne = neutre.
    if (t.type === "transfer" && accountType.get(t.accountId) === "savings") {
      const counterpartType = t.counterpartAccountId ? accountType.get(t.counterpartAccountId) : undefined;
      const involved =
        accountId === null || t.accountId === accountId || t.counterpartAccountId === accountId;
      if (counterpartType !== "savings" && involved) savingsTransfersCents += t.amountCents;
    }
  }

  const netCents = incomeCents - expenseCents;
  return {
    incomeCents,
    expenseCents,
    netCents,
    interestCents,
    savingsTransfersCents,
    savedCents: savingsTransfersCents + interestCents,
    savingsRate: incomeCents > 0 ? netCents / incomeCents : null,
  };
}

/** Total signé affiché dans la liste des transactions : virements neutres en vue « tous comptes ». */
export function signedTotal(txs: Transaction[], accountId: string | null): number {
  return txs.reduce((sum, t) => {
    if (accountId === null ? t.type === "transfer" : t.accountId !== accountId) return sum;
    return sum + t.amountCents;
  }, 0);
}

export interface CategoryAmount {
  categoryId: string | null;
  cents: number;
  share: number;
}

/** Répartition des dépenses par catégorie (virements exclus), triée décroissante. */
export function expensesByCategory(txs: Transaction[]): CategoryAmount[] {
  const totals = new Map<string | null, number>();
  let total = 0;
  for (const t of txs) {
    if (!isExpense(t)) continue;
    totals.set(t.categoryId, (totals.get(t.categoryId) ?? 0) - t.amountCents);
    total -= t.amountCents;
  }
  return [...totals.entries()]
    .map(([categoryId, cents]) => ({ categoryId, cents, share: total > 0 ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

/** Dépenses totales par mois budgétaire, pour les mois demandés (dans l'ordre). */
export function monthlyExpenses(
  txs: Transaction[],
  months: MonthKey[],
  startDay = 1,
): { month: MonthKey; cents: number }[] {
  const totals = new Map<MonthKey, number>(months.map((m) => [m, 0]));
  for (const t of txs) {
    if (!isExpense(t)) continue;
    const key = monthKeyOf(t.date, startDay);
    if (totals.has(key)) totals.set(key, totals.get(key)! - t.amountCents);
  }
  return months.map((month) => ({ month, cents: totals.get(month)! }));
}

export interface PlaceAmount {
  place: string;
  cents: number;
  count: number;
}

/** Classement des lieux les plus coûteux (sorties uniquement). */
export function topPlaces(txs: Transaction[], limit = 5): PlaceAmount[] {
  const byKey = new Map<string, PlaceAmount>();
  for (const t of txs) {
    if (!isExpense(t) || !t.place?.trim()) continue;
    const key = t.place.trim().toLowerCase();
    const entry = byKey.get(key) ?? { place: t.place.trim(), cents: 0, count: 0 };
    entry.cents -= t.amountCents;
    entry.count += 1;
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.cents - a.cents).slice(0, limit);
}

/** Solde d'un compte = solde initial + somme signée de TOUTES ses lignes. */
export function accountBalance(account: Account, txs: Transaction[]): number {
  return txs.reduce(
    (sum, t) => (t.accountId === account.id ? sum + t.amountCents : sum),
    account.initialBalanceCents,
  );
}

/** Solde en fin de chaque date donnée (courbes / sparklines). `ends` triées croissantes. */
export function balanceSeries(account: Account, txs: Transaction[], ends: IsoDate[]): number[] {
  const own = txs.filter((t) => t.accountId === account.id).sort((a, b) => (a.date < b.date ? -1 : 1));
  const result: number[] = [];
  let running = account.initialBalanceCents;
  let i = 0;
  for (const end of ends) {
    while (i < own.length && own[i]!.date <= end) running += own[i++]!.amountCents;
    result.push(running);
  }
  return result;
}

/**
 * Même résultat que balanceSeries, mais à partir du solde actuel : solde fin de période =
 * solde actuel − mouvements postérieurs. Ne nécessite que les transactions depuis la
 * première date demandée (pas tout l'historique).
 */
export function balanceSeriesFromCurrent(
  accountId: string,
  currentBalanceCents: number,
  txs: Transaction[],
  ends: IsoDate[],
): number[] {
  const own = txs.filter((t) => t.accountId === accountId);
  return ends.map(
    (end) => currentBalanceCents - own.reduce((sum, t) => (t.date > end ? sum + t.amountCents : sum), 0),
  );
}

/** Groupement par jour (liste des transactions), jours décroissants. */
export function groupByDay<T extends { date: IsoDate }>(items: T[]): { date: IsoDate; items: T[] }[] {
  const groups = new Map<IsoDate, T[]>();
  for (const item of items) {
    const list = groups.get(item.date);
    if (list) list.push(item);
    else groups.set(item.date, [item]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({ date, items: list }));
}
