/** Types métier, indépendants de la base (Supabase aujourd'hui, Postgres auto-hébergé demain). */

export type AccountType = "current" | "savings" | "cash";

/** out = sortie, in = entrée, interest = intérêts d'épargne, adjust = régularisation */
export type TransactionType = "out" | "in" | "transfer" | "interest" | "adjust";

export type BudgetMode = "fixed" | "percent";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  initialBalanceCents: number;
  /** YYYY-MM-DD */
  initialBalanceDate: string;
  color: string;
  icon: string;
  inBudget: boolean;
  sortOrder: number;
  archivedAt: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  isIncome: boolean;
  /** Vide = tous les comptes « dans le budget » */
  restrictedAccountIds: string[];
  sortOrder: number;
  archivedAt: string | null;
}

export interface Budget {
  id: string;
  categoryId: string;
  mode: BudgetMode;
  amountCents: number;
  /** 0–100, utilisé si mode = percent */
  percent: number | null;
}

export interface Transaction {
  id: string;
  accountId: string;
  type: TransactionType;
  /** Signé du point de vue du compte : sortie < 0, entrée > 0 */
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  place: string | null;
  categoryId: string | null;
  note: string | null;
  counterpartAccountId: string | null;
  transferId: string | null;
  recurrenceId: string | null;
  createdAt: string;
}

export interface Profile {
  id: string;
  email: string;
  displayName: string | null;
  currency: string;
  monthStartDay: number;
  theme: "light" | "dark";
  referenceIncomeCents: number;
  budgetCarryOver: boolean;
  lastBackupAt: string | null;
}

export interface PlaceMemoryEntry {
  place: string;
  categoryId: string | null;
  accountId: string;
  lastUsed: string;
}
