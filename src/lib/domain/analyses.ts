/**
 * Analyses : comparaisons mensuelles, épargne cumulée, évolution d'une catégorie.
 * Les virements restent exclus des dépenses, comme partout ailleurs.
 */
import type { Account, Transaction } from "./types";
import { isExpense } from "./stats";
import { monthKeyOf, type MonthKey } from "./dates";

export interface CategoryComparison {
  categoryId: string | null;
  currentCents: number;
  previousCents: number;
  /** Variation relative ; null si rien le mois précédent (catégorie nouvelle) */
  change: number | null;
}

/** Dépenses par catégorie : mois en cours vs mois précédent, triées par amplitude de variation. */
export function compareMonths(current: Transaction[], previous: Transaction[]): CategoryComparison[] {
  const sum = (txs: Transaction[]) => {
    const m = new Map<string | null, number>();
    for (const t of txs) if (isExpense(t)) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) - t.amountCents);
    return m;
  };
  const cur = sum(current);
  const prev = sum(previous);
  const keys = new Set([...cur.keys(), ...prev.keys()]);
  return [...keys]
    .map((categoryId) => {
      const currentCents = cur.get(categoryId) ?? 0;
      const previousCents = prev.get(categoryId) ?? 0;
      return { categoryId, currentCents, previousCents, change: previousCents > 0 ? (currentCents - previousCents) / previousCents : null };
    })
    .filter((c) => c.currentCents > 0 || c.previousCents > 0)
    .sort((a, b) => Math.abs(b.currentCents - b.previousCents) - Math.abs(a.currentCents - a.previousCents));
}

export interface SavingsByAccount {
  account: Account;
  /** Virements nets reçus d'un compte non-épargne */
  transfersCents: number;
  interestCents: number;
  totalCents: number;
}

/** Épargne cumulée par compte d'épargne sur les transactions fournies (virements / intérêts). */
export function savingsByAccount(txs: Transaction[], accounts: Account[]): SavingsByAccount[] {
  const typeOf = new Map(accounts.map((a) => [a.id, a.type]));
  return accounts
    .filter((a) => a.type === "savings" && !a.archivedAt)
    .map((account) => {
      let transfersCents = 0;
      let interestCents = 0;
      for (const t of txs) {
        if (t.accountId !== account.id) continue;
        if (t.type === "interest") interestCents += t.amountCents;
        if (t.type === "transfer" && (!t.counterpartAccountId || typeOf.get(t.counterpartAccountId) !== "savings")) {
          transfersCents += t.amountCents;
        }
      }
      return { account, transfersCents, interestCents, totalCents: transfersCents + interestCents };
    });
}

/** Dépenses d'une catégorie par mois budgétaire. */
export function categorySeries(
  txs: Transaction[],
  categoryId: string,
  months: MonthKey[],
  startDay = 1,
): { month: MonthKey; cents: number }[] {
  const totals = new Map(months.map((m) => [m, 0]));
  for (const t of txs) {
    if (!isExpense(t) || t.categoryId !== categoryId) continue;
    const key = monthKeyOf(t.date, startDay);
    if (totals.has(key)) totals.set(key, totals.get(key)! - t.amountCents);
  }
  return months.map((month) => ({ month, cents: totals.get(month)! }));
}
