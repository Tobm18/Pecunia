/**
 * Validation d'une saisie (formulaire rapide, saisie en lot, import) et construction des
 * lignes à enregistrer. Un virement produit deux lignes liées par transfer_id.
 */
import type { Account, Transaction } from "./types";
import { parseAmountToCents } from "./money";
import { isValidIsoDate } from "./dates";

export type EntryKind = "out" | "in" | "transfer";
/** Nature d'une entrée sur un compte d'épargne */
export type IncomeNature = "income" | "interest";

export interface EntryInput {
  kind: EntryKind;
  amount: string;
  place: string;
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  nature: IncomeNature;
  date: string;
  note: string;
}

export type NewTransaction = Omit<Transaction, "id" | "createdAt" | "recurrenceId">;

export const ENTRY_ERRORS = {
  amountAndPlace: "Montant et lieu requis.",
  amount: "Montant requis.",
  category: "Choisis une catégorie.",
  account: "Choisis un compte.",
  sameAccounts: "Choisis deux comptes différents.",
  date: "Date invalide.",
} as const;

export type EntryResult = { ok: true; rows: NewTransaction[] } | { ok: false; error: string };

/** Le segment « Intérêts / Revenu » n'apparaît que pour une entrée sur un compte d'épargne. */
export function needsNature(kind: EntryKind, account: Account | undefined): boolean {
  return kind === "in" && account?.type === "savings";
}

export function buildEntry(input: EntryInput, accounts: Account[], newId: () => string): EntryResult {
  const cents = parseAmountToCents(input.amount);
  const place = input.place.trim();
  const note = input.note.trim() || null;
  const byId = new Map(accounts.map((a) => [a.id, a]));

  if (!isValidIsoDate(input.date)) return { ok: false, error: ENTRY_ERRORS.date };

  if (input.kind === "transfer") {
    if (cents === null || cents <= 0) return { ok: false, error: ENTRY_ERRORS.amount };
    const from = input.accountId ? byId.get(input.accountId) : undefined;
    const to = input.toAccountId ? byId.get(input.toAccountId) : undefined;
    if (!from || !to) return { ok: false, error: ENTRY_ERRORS.account };
    if (from.id === to.id) return { ok: false, error: ENTRY_ERRORS.sameAccounts };
    const transferId = newId();
    const label = place || `Virement ${to.name}`;
    const common = { type: "transfer" as const, date: input.date, place: label, categoryId: null, note, transferId };
    return {
      ok: true,
      rows: [
        { ...common, accountId: from.id, counterpartAccountId: to.id, amountCents: -cents },
        { ...common, accountId: to.id, counterpartAccountId: from.id, amountCents: cents },
      ],
    };
  }

  if (cents === null || cents <= 0 || !place) return { ok: false, error: ENTRY_ERRORS.amountAndPlace };
  const account = input.accountId ? byId.get(input.accountId) : undefined;
  if (!account) return { ok: false, error: ENTRY_ERRORS.account };

  const interest = needsNature(input.kind, account) && input.nature === "interest";
  if (!input.categoryId && !interest) return { ok: false, error: ENTRY_ERRORS.category };

  return {
    ok: true,
    rows: [
      {
        type: input.kind === "out" ? "out" : interest ? "interest" : "in",
        accountId: account.id,
        amountCents: input.kind === "out" ? -cents : cents,
        date: input.date,
        place,
        categoryId: input.categoryId,
        note,
        counterpartAccountId: null,
        transferId: null,
      },
    ],
  };
}

/**
 * Ajustement de solde : écart entre le solde réel (banque) et le solde calculé.
 * Renvoie null si l'écart est inférieur à 1 centime (aucune régularisation).
 */
export function adjustmentCents(computedCents: number, realCents: number): number | null {
  const diff = realCents - computedCents;
  return Math.abs(diff) >= 1 ? diff : null;
}
