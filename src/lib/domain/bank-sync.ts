/**
 * Connexion bancaire - logique pure : transforme les écritures renvoyées par la banque
 * (format Enable Banking) en lignes Pecunia, et choisit le solde de référence.
 */
import { normalizeText } from "./csv-import";
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
  creditor_account?: AccountIdentification | null;
  debtor_account?: AccountIdentification | null;
  note?: string | null;
}

export interface AccountIdentification {
  iban?: string | null;
  other?: { identification?: string | null } | null;
}

export interface BankBalance {
  balance_type: string;
  balance_amount: { amount: string; currency?: string };
  reference_date?: string | null;
  last_change_date_time?: string | null;
}

export interface BankLine {
  /** Référence stable de la ligne chez la banque (sert à ne jamais l'importer deux fois) */
  ref: string;
  date: IsoDate;
  /** Signé : sortie < 0, entrée > 0 */
  cents: number;
  label: string;
  /** Compte en face, normalisé (null si la banque ne le donne pas) */
  counterparty: string | null;
}

const MAX_LABEL = 120;

/** IBAN ou numéro de compte comparable : sans espaces ni séparateurs, en majuscules. */
export function normalizeIdentifier(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s || null;
}

/** Compte en face : le compte créditeur d'un débit, le donneur d'ordre d'un crédit. */
export function counterpartyOf(t: BankTransaction): string | null {
  const account = t.credit_debit_indicator === "DBIT" ? t.creditor_account : t.debtor_account;
  return normalizeIdentifier(account?.iban) ?? normalizeIdentifier(account?.other?.identification);
}

/** Longueur minimale d'un identifiant de compte interne (évite qu'un fragment trop court reconnaisse n'importe quoi) */
export const MIN_IDENTIFIER_LENGTH = 5;

/**
 * Le compte en face d'une ligne est-il ce compte interne ? Égalité, ou numéro de compte contenu
 * dans l'IBAN (et inversement) : un IBAN français contient le numéro du compte.
 */
export function matchesIdentifier(counterparty: string | null, identifier: string | null): boolean {
  const a = normalizeIdentifier(counterparty);
  const b = normalizeIdentifier(identifier);
  if (!a || !b || Math.min(a.length, b.length) < MIN_IDENTIFIER_LENGTH) return false;
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Compte interne visé par une ligne : d'abord par le compte en face (l'identifiant le plus précis),
 * à défaut par mot-clé du libellé (le plus long). Le mot-clé « reçus » (keywordIn) ne s'applique
 * qu'aux lignes créditrices : un virement reçu d'un livret nomme la destination, pas la source.
 */
export function findInternalAccount<T extends { id: string; identifier: string | null; keyword: string | null; keywordIn?: string | null }>(
  line: { counterparty: string | null; label: string | null; cents: number },
  accounts: T[],
): T | null {
  const size = (s: string | null) => (s ?? "").length;
  const byIdentifier = accounts.filter((a) => matchesIdentifier(line.counterparty, a.identifier));
  if (byIdentifier.length) return byIdentifier.reduce((best, a) => (size(normalizeIdentifier(a.identifier)) > size(normalizeIdentifier(best.identifier)) ? a : best));
  let best: T | null = null;
  let bestSize = 0;
  for (const a of accounts) {
    const keywords = line.cents > 0 ? [a.keyword, a.keywordIn ?? null] : [a.keyword];
    for (const keyword of keywords) {
      if (!matchesInternalAccount({ counterparty: null, label: line.label }, { identifier: null, keyword })) continue;
      if (size(keyword) > bestSize) {
        best = a;
        bestSize = size(keyword);
      }
    }
  }
  return best;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Libellé lisible : le texte de l'opération, à défaut le nom de la contrepartie. */
export function bankLabel(t: BankTransaction): string {
  const outgoing = t.credit_debit_indicator === "DBIT";
  const remittance = clean((t.remittance_information ?? []).join(" "));
  const counterparty = clean((outgoing ? t.creditor?.name : t.debtor?.name) ?? "");
  const label = remittance || counterparty || clean(t.note ?? "");
  return label.slice(0, MAX_LABEL);
}

/** Préfixe des références d'opérations en cours : remplacées en bloc à chaque synchronisation */
export const PENDING_REF_PREFIX = "pdng:";

/**
 * Écritures de la banque → lignes Pecunia. Par défaut, seules les écritures comptabilisées sont
 * gardées ; avec `pending`, seules les opérations en cours (paiements par carte pas encore
 * comptabilisés). Sans référence propre à la banque, la référence est dérivée de la date, du
 * montant et du libellé, numérotée quand plusieurs écritures sont identiques (deux cafés au même
 * prix). Une opération en cours a toujours une référence dérivée : celle de la banque change
 * souvent à la comptabilisation, et ces lignes sont de toute façon remplacées à chaque fois.
 */
export function toBankLines(transactions: BankTransaction[], options: { pending?: boolean } = {}): BankLine[] {
  const seen = new Map<string, number>();
  const lines: BankLine[] = [];
  const wanted = options.pending ? "PDNG" : "BOOK";
  for (const t of transactions) {
    if (t.status && t.status !== wanted) continue;
    const date = [t.booking_date, t.value_date, t.transaction_date].find((d): d is string => !!d && isValidIsoDate(d.slice(0, 10)))?.slice(0, 10);
    const abs = parseAmountToCents(t.transaction_amount.amount.replace("-", ""));
    if (!date || abs === null || abs === 0) continue;
    const cents = t.credit_debit_indicator === "DBIT" ? -abs : abs;
    const label = bankLabel(t);
    const own = options.pending ? null : t.entry_reference || t.transaction_id;
    let ref: string;
    if (own) {
      ref = `id:${own}`;
    } else {
      const base = `${date}|${cents}|${label}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      ref = `${options.pending ? PENDING_REF_PREFIX : "h:"}${base}|${n}`;
    }
    lines.push({ ref, date, cents, label: label || "Sans libellé", counterparty: counterpartyOf(t) });
  }
  return lines;
}

export interface ReferenceBalance {
  type: string;
  cents: number;
  /** Jour auquel le solde est arrêté (null : aujourd'hui) */
  date: IsoDate | null;
}

/** Soldes de la banque, lisibles (type, centimes, date de référence). */
export function readBalances(balances: BankBalance[]): ReferenceBalance[] {
  return balances.flatMap((b) => {
    const cents = parseAmountToCents(b.balance_amount.amount);
    if (cents === null) return [];
    const date = b.reference_date?.slice(0, 10) ?? b.last_change_date_time?.slice(0, 10) ?? null;
    return [{ type: b.balance_type, cents, date: date && isValidIsoDate(date) ? date : null }];
  });
}

/**
 * Solde comptabilisé de référence : intermédiaire (le plus récent), à défaut de clôture, à défaut
 * le premier fourni. Les opérations en cours n'y sont pas : elles s'ajoutent par-dessus.
 */
export function pickBookedBalance(balances: BankBalance[]): ReferenceBalance | null {
  const read = readBalances(balances);
  return ["ITBD", "CLBD", "XPCD", "OPBD"].map((type) => read.find((b) => b.type === type)).find(Boolean) ?? read[0] ?? null;
}

/**
 * Solde initial à enregistrer pour que le solde Pecunia (solde initial + toutes les lignes) soit
 * exactement celui de la banque, `transactionsSumCents` étant la somme des lignes comptabilisées
 * jusqu'au jour du solde.
 */
export function initialBalanceFor(bankBalanceCents: number, transactionsSumCents: number): number {
  return bankBalanceCents - transactionsSumCents;
}

/**
 * Une ligne du compte synchronisé vise-t-elle ce compte interne ? Par le compte en face quand la
 * banque le donne, sinon par un mot-clé du libellé (sans accents ni casse).
 */
export function matchesInternalAccount(
  line: { counterparty: string | null; label: string | null },
  account: { identifier: string | null; keyword: string | null },
): boolean {
  if (matchesIdentifier(line.counterparty, account.identifier)) return true;
  const keyword = normalizeLabel(account.keyword ?? "");
  return keyword.length >= MIN_KEYWORD_LENGTH && normalizeLabel(line.label ?? "").includes(keyword);
}

export const MIN_KEYWORD_LENGTH = 3;

const normalizeLabel = (s: string) => normalizeText(s).replace(/\s+/g, " ");

/**
 * Nom lisible d'un compte bancaire. Le champ « name » de la banque est celui du titulaire : on
 * préfère le produit ou le libellé du compte, à défaut un nom générique avec la fin de l'IBAN.
 */
export function bankAccountLabel(a: { product?: string | null; details?: string | null; cash_account_type?: string | null }, iban: string | null): string {
  const named = clean(a.product ?? "") || clean(a.details ?? "");
  if (named) return named.slice(0, 60);
  const generic = a.cash_account_type === "SVGS" ? "Épargne" : "Compte courant";
  return iban ? `${generic} …${iban.slice(-4)}` : generic;
}

/**
 * Rappel des intérêts d'épargne : du 31 décembre au 31 janvier, pour l'année écoulée, tant qu'un
 * compte épargne n'a reçu aucune ligne d'intérêts datée de décembre ou janvier. Renvoie l'année
 * concernée et les comptes à compléter, ou null hors période.
 */
export function interestReminder<T extends { id: string }>(
  today: IsoDate,
  savingsAccounts: T[],
  interestDates: { accountId: string; date: IsoDate }[],
): { year: number; accounts: T[] } | null {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const inWindow = (m === 12 && d === 31) || m === 1;
  if (!inWindow) return null;
  const year = m === 12 ? y : y - 1;
  const from = `${year}-12-01`;
  const to = `${year + 1}-01-31`;
  const done = new Set(interestDates.filter((i) => i.date >= from && i.date <= to).map((i) => i.accountId));
  const pending = savingsAccounts.filter((a) => !done.has(a.id));
  return pending.length ? { year, accounts: pending } : null;
}

/** Type de compte Pecunia deviné d'après le nom du compte bancaire. */
export function guessAccountType(name: string | null): "current" | "savings" {
  return /livret|epargne|épargne|\bpel\b|\bcel\b|\bldd[sp]?\b|pep\b/i.test(name ?? "") ? "savings" : "current";
}
