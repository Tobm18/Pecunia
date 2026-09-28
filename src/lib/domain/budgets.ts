/**
 * Budgets par catégorie : montant fixe ou pourcentage du revenu de référence.
 * Seules les dépenses (« out ») des comptes concernés comptent — jamais les virements.
 */
import type { Account, Budget, Category, Transaction } from "./types";
import { isExpense } from "./stats";

export type BudgetStatus = "ok" | "warn" | "over";

export const WARN_THRESHOLD = 0.8;
export const OVER_THRESHOLD = 1;

/** < 80 % vert · ≥ 80 % orange · ≥ 100 % rouge */
export function budgetStatus(ratio: number): BudgetStatus {
  if (ratio >= OVER_THRESHOLD) return "over";
  if (ratio >= WARN_THRESHOLD) return "warn";
  return "ok";
}

export function effectiveBudgetCents(budget: Budget, referenceIncomeCents: number): number {
  if (budget.mode === "percent") {
    return Math.round((referenceIncomeCents * (budget.percent ?? 0)) / 100);
  }
  return budget.amountCents;
}

/**
 * Comptes pris en compte pour une catégorie : ses comptes restreints s'il y en a,
 * sinon tous les comptes « dans le budget ».
 */
export function budgetAccountIds(category: Category, accounts: Account[]): Set<string> {
  if (category.restrictedAccountIds.length > 0) return new Set(category.restrictedAccountIds);
  return new Set(accounts.filter((a) => a.inBudget).map((a) => a.id));
}

export function categorySpentCents(txs: Transaction[], category: Category, accounts: Account[]): number {
  const accountIds = budgetAccountIds(category, accounts);
  return txs.reduce(
    (sum, t) =>
      isExpense(t) && t.categoryId === category.id && accountIds.has(t.accountId) ? sum - t.amountCents : sum,
    0,
  );
}

export interface BudgetLine {
  category: Category;
  budget: Budget;
  budgetCents: number;
  spentCents: number;
  /** budget − dépensé (négatif si dépassé) */
  remainingCents: number;
  ratio: number;
  status: BudgetStatus;
}

export interface BudgetOverview {
  lines: BudgetLine[];
  /** Somme des budgets + report éventuel */
  totalBudgetCents: number;
  carryOverCents: number;
  /** Toutes les dépenses des comptes « dans le budget » */
  totalSpentCents: number;
  remainingCents: number;
  ratio: number;
  status: BudgetStatus;
  /** Lignes ≥ 80 %, les plus critiques d'abord */
  alerts: BudgetLine[];
}

export function computeBudgets(params: {
  budgets: Budget[];
  categories: Category[];
  accounts: Account[];
  /** Transactions de la période uniquement */
  txs: Transaction[];
  referenceIncomeCents: number;
  carryOverCents?: number;
}): BudgetOverview {
  const { budgets, categories, accounts, txs, referenceIncomeCents, carryOverCents = 0 } = params;
  const activeCategories = new Map(
    categories.filter((c) => !c.archivedAt && !c.isIncome).map((c) => [c.id, c]),
  );

  const lines: BudgetLine[] = [];
  for (const budget of budgets) {
    const category = activeCategories.get(budget.categoryId);
    if (!category) continue; // catégorie archivée : budget retiré du calcul global
    const budgetCents = effectiveBudgetCents(budget, referenceIncomeCents);
    const spentCents = categorySpentCents(txs, category, accounts);
    const ratio = budgetCents > 0 ? spentCents / budgetCents : spentCents > 0 ? Infinity : 0;
    lines.push({
      category,
      budget,
      budgetCents,
      spentCents,
      remainingCents: budgetCents - spentCents,
      ratio,
      status: budgetStatus(ratio),
    });
  }
  lines.sort((a, b) => a.category.sortOrder - b.category.sortOrder);

  const inBudget = new Set(accounts.filter((a) => a.inBudget).map((a) => a.id));
  const totalSpentCents = txs.reduce(
    (sum, t) => (isExpense(t) && inBudget.has(t.accountId) ? sum - t.amountCents : sum),
    0,
  );
  const totalBudgetCents = lines.reduce((sum, l) => sum + l.budgetCents, 0) + carryOverCents;
  const ratio = totalBudgetCents > 0 ? totalSpentCents / totalBudgetCents : 0;

  return {
    lines,
    totalBudgetCents,
    carryOverCents,
    totalSpentCents,
    remainingCents: totalBudgetCents - totalSpentCents,
    ratio,
    status: budgetStatus(ratio),
    alerts: lines.filter((l) => l.status !== "ok").sort((a, b) => b.ratio - a.ratio),
  };
}

/**
 * Reste du mois précédent à reporter : budgets du mois précédent − ses dépenses,
 * jamais négatif et sans cumuler les reports antérieurs.
 */
export function carryOverFrom(previous: BudgetOverview): number {
  return Math.max(0, previous.totalBudgetCents - previous.carryOverCents - previous.totalSpentCents);
}

/**
 * Détecte le franchissement d'un seuil (80 % ou 100 %) par une nouvelle dépense,
 * pour le bandeau d'avertissement de la saisie.
 */
export function crossedThreshold(
  budgetCents: number,
  spentBeforeCents: number,
  spentAfterCents: number,
): { ratio: number; over: boolean } | null {
  if (budgetCents <= 0) return null;
  const before = spentBeforeCents / budgetCents;
  const after = spentAfterCents / budgetCents;
  const crossed =
    (before < WARN_THRESHOLD && after >= WARN_THRESHOLD) || (before < OVER_THRESHOLD && after >= OVER_THRESHOLD);
  return crossed ? { ratio: after, over: after >= OVER_THRESHOLD } : null;
}
