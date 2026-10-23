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
  /** Origine de la catégorie (manual, learned, rule, directory, fallback…) ; absente = saisie manuelle */
  categorySource?: string | null;
  /** Score de confiance de la catégorie, 0 à 100 */
  categoryConfidence?: number | null;
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
  /** Coussin de sécurité retiré de la marge communiquée à l'app des souhaits */
  wishCushionCents: number;
}

export interface PlaceMemoryEntry {
  place: string;
  categoryId: string | null;
  accountId: string;
  lastUsed: string;
}

export type RecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

/** Modèle de mouvement répété (loyer, abonnement, salaire, virement d'épargne). */
export interface Recurrence {
  id: string;
  type: "out" | "in" | "transfer";
  label: string;
  /** Toujours positif ; le sens vient du type */
  amountCents: number;
  categoryId: string | null;
  accountId: string;
  /** Compte de destination d'un virement */
  toAccountId: string | null;
  frequency: RecurrenceFrequency;
  /** Jour d'échéance (1–31, ramené au dernier jour du mois si besoin) */
  dueDay: number;
  startDate: string;
  endDate: string | null;
  isSubscription: boolean;
}

/** Dépense ou revenu ponctuel prévu (montant signé). */
export interface ForecastItem {
  id: string;
  accountId: string;
  label: string;
  amountCents: number;
  date: string;
  status: "planned" | "linked";
  linkedTransactionId: string | null;
  /** Lignes créées ensemble pour plusieurs mois */
  seriesId: string | null;
  /** Virement interne : compte crédité (amountCents, négatif, porte sur accountId) */
  toAccountId: string | null;
  /** Ligne issue d'un souhait accepté (voir Wish) */
  wishId: string | null;
}

/**
 * Souhait : achat en attente tenu à jour par une autre app (G Koi À Faire), avec son coût estimé.
 * Il est proposé dans le prévisionnel ; accepté, il devient une ligne prévue (ForecastItem.wishId).
 */
export interface Wish {
  id: string;
  source: string;
  externalId: string;
  title: string;
  /** Coût estimé, positif */
  amountCents: number;
  priority: "high" | "medium" | "low" | null;
  dueDate: string | null;
}

/** Décision sur une proposition du prévisionnel (échéance ou budget) pour un mois. */
export interface ForecastDecision {
  id: string;
  /** « rec:<récurrence>:<date> », « bud:<catégorie>:<mois> » ou « wish:<souhait>:<mois> » */
  sourceKey: string;
  month: string;
  status: "accepted" | "rejected";
  /** Valeurs modifiées ; null = celles proposées */
  amountCents: number | null;
  accountId: string | null;
  date: string | null;
}

export interface Goal {
  id: string;
  accountId: string;
  name: string;
  targetCents: number;
  targetDate: string;
}
