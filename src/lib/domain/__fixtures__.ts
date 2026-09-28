import type { Account, Budget, Category, Transaction } from "./types";

export const account = (over: Partial<Account> & Pick<Account, "id">): Account => ({
  name: over.id,
  type: "current",
  initialBalanceCents: 0,
  initialBalanceDate: "2026-01-01",
  color: "#000",
  icon: "card",
  inBudget: true,
  sortOrder: 0,
  archivedAt: null,
  ...over,
});

export const category = (over: Partial<Category> & Pick<Category, "id">): Category => ({
  name: over.id,
  color: "#000",
  icon: "circle",
  isIncome: false,
  restrictedAccountIds: [],
  sortOrder: 0,
  archivedAt: null,
  ...over,
});

export const budget = (over: Partial<Budget> & Pick<Budget, "categoryId">): Budget => ({
  id: `b-${over.categoryId}`,
  mode: "fixed",
  amountCents: 0,
  percent: null,
  ...over,
});

let seq = 0;
export const tx = (over: Partial<Transaction> & Pick<Transaction, "accountId" | "type" | "amountCents">): Transaction => ({
  id: `t${++seq}`,
  date: "2026-09-15",
  place: null,
  categoryId: null,
  note: null,
  counterpartAccountId: null,
  transferId: null,
  recurrenceId: null,
  createdAt: "2026-09-15T00:00:00Z",
  ...over,
});

export const transfer = (from: string, to: string, cents: number, date = "2026-09-10"): Transaction[] => {
  const transferId = `tr-${from}-${to}-${cents}-${date}`;
  return [
    tx({ accountId: from, counterpartAccountId: to, type: "transfer", amountCents: -cents, transferId, date }),
    tx({ accountId: to, counterpartAccountId: from, type: "transfer", amountCents: cents, transferId, date }),
  ];
};

/** Extrait du jeu de démonstration des maquettes (septembre 2026). */
export const demoAccounts = [
  account({ id: "courant", type: "current", inBudget: true }),
  account({ id: "livret", type: "savings", inBudget: false }),
  account({ id: "voyage", type: "savings", inBudget: false }),
  account({ id: "especes", type: "cash", inBudget: true }),
];

export const demoTransactions: Transaction[] = [
  tx({ accountId: "courant", type: "in", amountCents: 320000, categoryId: "salaire", place: "ACME SAS" }),
  tx({ accountId: "courant", type: "in", amountCents: 4500, categoryId: "autres", place: "Remboursement Léa" }),
  tx({ accountId: "voyage", type: "interest", amountCents: 840, place: "Intérêts Épargne voyage" }),
  tx({ accountId: "courant", type: "adjust", amountCents: 312, place: "Régularisation" }),
  tx({ accountId: "courant", type: "out", amountCents: -105000, categoryId: "logement", place: "Loyer — SCI Belleville" }),
  tx({ accountId: "courant", type: "out", amountCents: -8430, categoryId: "courses", place: "Carrefour" }),
  tx({ accountId: "courant", type: "out", amountCents: -11260, categoryId: "courses", place: "carrefour " }),
  tx({ accountId: "especes", type: "out", amountCents: -1850, categoryId: "courses", place: "Marché d'Aligre" }),
  tx({ accountId: "courant", type: "out", amountCents: -3250, categoryId: "restaurants", place: "Le Petit Bouillon" }),
  ...transfer("courant", "voyage", 15000),
  ...transfer("courant", "livret", 20000),
  ...transfer("courant", "especes", 6000),
];
