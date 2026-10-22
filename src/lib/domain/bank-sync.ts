/**
 * Connexion bancaire - logique pure : transforme les écritures renvoyées par la banque
 * (format Enable Banking) en lignes Pecunia, et choisit le solde de référence.
 */
import { parseAmountToCents } from "./money";
import { isValidIsoDate, type IsoDate } from "./dates";

/** Écriture telle que renvoyée par GET /accounts/{uid}/transactions (champs utiles seulement). */
export interface BankTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: { amount: string; currency?: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  note?: string | null;
}

export interface BankBalance {
  balance_type: string;
  balance_amount: { amount: string; currency?: string };
}

export interface BankLine {
  /** Référence stable de la ligne chez la banque (sert à ne jamais l'importer deux fois) */
  ref: string;
  date: IsoDate;
  /** Signé : sortie < 0, entrée > 0 */
  cents: number;
  label: string;
}

const MAX_LABEL = 120;

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Libellé lisible : le texte de l'opération, à défaut le nom de la contrepartie. */
export function bankLabel(t: BankTransaction): string {
  const outgoing = t.credit_debit_indicator === "DBIT";
  const remittance = clean((t.remittance_information ?? []).join(" "));
  const counterparty = clean((outgoing ? t.creditor?.name : t.debtor?.name) ?? "");
  const label = remittance || counterparty || clean(t.note ?? "");
  return label.slice(0, MAX_LABEL);
}

/**
 * Écritures de la banque → lignes Pecunia. Seules les écritures comptabilisées sont gardées.
 * Sans référence propre à la banque, la référence est dérivée de la date, du montant et du
 * libellé, numérotée quand plusieurs écritures sont identiques (deux cafés au même prix).
 */
export function toBankLines(transactions: BankTransaction[]): BankLine[] {
  const seen = new Map<string, number>();
  const lines: BankLine[] = [];
  for (const t of transactions) {
    if (t.status && t.status !== "BOOK") continue;
    const date = [t.booking_date, t.value_date, t.transaction_date].find((d): d is string => !!d && isValidIsoDate(d.slice(0, 10)))?.slice(0, 10);
    const abs = parseAmountToCents(t.transaction_amount.amount.replace("-", ""));
    if (!date || abs === null || abs === 0) continue;
    const cents = t.credit_debit_indicator === "DBIT" ? -abs : abs;
    const label = bankLabel(t);
    const own = t.entry_reference || t.transaction_id;
    let ref: string;
    if (own) {
      ref = `id:${own}`;
    } else {
      const base = `${date}|${cents}|${label}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      ref = `h:${base}|${n}`;
    }
    lines.push({ ref, date, cents, label: label || "Sans libellé" });
  }
  return lines;
}

/** Solde comptabilisé de référence : clôture, à défaut intermédiaire, à défaut le premier. */
export function pickBalanceCents(balances: BankBalance[]): number | null {
  const preferred = ["CLBD", "ITBD", "XPCD", "OPBD"];
  const chosen = preferred.map((type) => balances.find((b) => b.balance_type === type)).find(Boolean) ?? balances[0];
  if (!chosen) return null;
  return parseAmountToCents(chosen.balance_amount.amount);
}

/**
 * Solde initial à enregistrer pour que le solde Pecunia (solde initial + toutes les lignes) soit
 * exactement celui de la banque.
 */
export function initialBalanceFor(bankBalanceCents: number, transactionsSumCents: number): number {
  return bankBalanceCents - transactionsSumCents;
}

/** Type de compte Pecunia deviné d'après le nom du compte bancaire. */
export function guessAccountType(name: string | null): "current" | "savings" {
  return /livret|epargne|épargne|\bpel\b|\bcel\b|\bldd[sp]?\b|pep\b/i.test(name ?? "") ? "savings" : "current";
}
