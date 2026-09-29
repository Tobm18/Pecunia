/**
 * Import CSV (tableur maison ou export bancaire) — logique pure, sans dépendance au navigateur.
 *
 * Format de référence (un fichier par compte) :
 *   Raison;Date;Recette;Depense;Total
 *   Salaire Thales;02/01/2026;1 527,03 €;;1 561,63 €
 *
 * Étapes (un fichier = un compte) : décodage (UTF-8 ou Windows-1252) → découpage CSV →
 * détection des colonnes → lignes normalisées → brouillon éditable (virements devinés,
 * catégories, lignes déjà enregistrées) → éléments envoyés au serveur.
 */
import type { Account, Category, PlaceMemoryEntry, Transaction } from "./types";
import { parseAmountToCents } from "./money";
import { isValidIsoDate, type IsoDate } from "./dates";

// ---------------------------------------------------------------------------
// Décodage et découpage
// ---------------------------------------------------------------------------

/** UTF-8 si le fichier est valide en UTF-8, sinon Windows-1252 (exports Excel FR). */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: "UTF-8" | "Windows-1252" } {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: text.replace(/^﻿/, ""), encoding: "UTF-8" };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), encoding: "Windows-1252" };
  }
}

/** Découpe une ligne CSV en respectant les guillemets ("a;b" et "" échappés). */
function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

export interface ParsedCsv {
  separator: string;
  header: string[];
  /** Lignes de données avec leur numéro de ligne dans le fichier (1 = en-tête) */
  rows: { line: number; cells: string[] }[];
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r\n|\n|\r/);
  const headerLine = lines.find((l) => l.trim()) ?? "";
  const separator = [";", "\t", ","].reduce((best, sep) =>
    headerLine.split(sep).length > headerLine.split(best).length ? sep : best,
  );
  const header = splitLine(headerLine, separator);
  const headerIndex = lines.indexOf(headerLine);
  const rows: ParsedCsv["rows"] = [];
  lines.forEach((l, i) => {
    if (i <= headerIndex || !l.trim()) return;
    const cells = splitLine(l, separator);
    if (cells.every((c) => !c)) return;
    rows.push({ line: i + 1, cells });
  });
  return { separator, header, rows };
}

// ---------------------------------------------------------------------------
// Colonnes
// ---------------------------------------------------------------------------

export type ColumnRole = "label" | "date" | "credit" | "debit" | "amount" | "balance" | "ignore";

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  label: "Lieu / libellé",
  date: "Date",
  credit: "Recette (entrée)",
  debit: "Dépense (sortie)",
  amount: "Montant signé",
  balance: "Solde (total)",
  ignore: "Ignorer",
};

export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const ROLE_PATTERNS: [ColumnRole, RegExp][] = [
  ["date", /^(date|jour|date operation|date d'operation)$/],
  ["credit", /^(recette|recettes|credit|credits|entree|entrees|encaissement)$/],
  ["debit", /^(depense|depenses|debit|debits|sortie|sorties|decaissement)$/],
  ["amount", /^(montant|somme|valeur|montant \(eur\)|montant eur)$/],
  ["balance", /^(total|solde|solde courant|balance)$/],
  ["label", /^(raison|libelle|lieu|description|intitule|motif|operation|nature|tiers|beneficiaire)$/],
];

/** Devine le rôle de chaque colonne d'après son en-tête. */
export function guessColumns(header: string[]): ColumnRole[] {
  const used = new Set<ColumnRole>();
  return header.map((h) => {
    const key = normalizeText(h);
    const match = ROLE_PATTERNS.find(([role, re]) => !used.has(role) && re.test(key));
    if (!match) return "ignore";
    used.add(match[0]);
    return match[0];
  });
}

/** Colonnes suffisantes : date + libellé + (montant signé ou recette/dépense). */
export function columnsProblem(roles: ColumnRole[]): string | null {
  if (!roles.includes("date")) return "Associe une colonne à « Date ».";
  if (!roles.includes("label")) return "Associe une colonne à « Lieu / libellé ».";
  if (!roles.includes("amount") && !roles.includes("credit") && !roles.includes("debit")) {
    return "Associe une colonne à « Montant signé », ou à « Recette » / « Dépense ».";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Valeurs
// ---------------------------------------------------------------------------

/** « 1 527,03 € » / « -0,25 € » / « 1.527,03 » / « 12.5 » → centimes (signés). */
export function parseImportAmount(raw: string): number | null {
  let s = raw.replace(/[\s  €]|EUR/gi, "").replace(/[−–]/g, "-");
  if (!s) return null;
  if (s.startsWith("(") && s.endsWith(")")) s = "-" + s.slice(1, -1);
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, ""); // 1.527,03
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, ""); // 1.527.000
  return parseAmountToCents(s.replace(",", "."));
}

/** « 02/01/2026 » / « 2/1/26 » / « 2026-01-02 » → « 2026-01-02 » */
export function parseImportDate(raw: string): IsoDate | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (fr) {
    d = Number(fr[1]);
    m = Number(fr[2]);
    y = Number(fr[3]);
    if (y < 100) y += 2000;
  } else if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else return null;
  const out = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return isValidIsoDate(out) ? out : null;
}

// ---------------------------------------------------------------------------
// Lignes normalisées
// ---------------------------------------------------------------------------

export interface ImportRow {
  /** Identifiant stable « fichier:ligne » */
  id: string;
  fileIndex: number;
  line: number;
  date: IsoDate;
  label: string;
  /** Signé : dépense < 0, recette > 0 */
  cents: number;
  balanceCents: number | null;
}

export interface RowsResult {
  rows: ImportRow[];
  /** Lignes illisibles (date ou montant) */
  errors: { line: number; reason: string }[];
}

export const EMPTY_LABEL = "Sans libellé";

export function extractRows(parsed: ParsedCsv, roles: ColumnRole[], fileIndex: number): RowsResult {
  const col = (role: ColumnRole) => roles.indexOf(role);
  const [iLabel, iDate, iCredit, iDebit, iAmount, iBalance] = (
    ["label", "date", "credit", "debit", "amount", "balance"] as ColumnRole[]
  ).map(col);
  const rows: ImportRow[] = [];
  const errors: RowsResult["errors"] = [];

  for (const { line, cells } of parsed.rows) {
    const cell = (i: number) => (i! >= 0 ? (cells[i!] ?? "") : "");
    const date = parseImportDate(cell(iDate!));
    if (!date) {
      errors.push({ line, reason: `Date illisible « ${cell(iDate!)} »` });
      continue;
    }
    let cents = 0;
    let readable = false;
    if (iAmount! >= 0 && cell(iAmount!)) {
      const v = parseImportAmount(cell(iAmount!));
      if (v !== null) {
        cents = v;
        readable = true;
      }
    }
    if (iCredit! >= 0 && cell(iCredit!)) {
      const v = parseImportAmount(cell(iCredit!));
      if (v !== null) {
        cents += Math.abs(v);
        readable = true;
      }
    }
    if (iDebit! >= 0 && cell(iDebit!)) {
      const v = parseImportAmount(cell(iDebit!));
      if (v !== null) {
        cents -= Math.abs(v);
        readable = true;
      }
    }
    if (!readable) {
      errors.push({ line, reason: "Montant absent ou illisible" });
      continue;
    }
    if (cents === 0) continue; // ligne neutre : rien à importer
    const balance = iBalance! >= 0 && cell(iBalance!) ? parseImportAmount(cell(iBalance!)) : null;
    rows.push({
      id: `${fileIndex}:${line}`,
      fileIndex,
      line,
      date,
      label: cell(iLabel!).trim() || EMPTY_LABEL,
      cents,
      balanceCents: balance,
    });
  }
  return { rows, errors };
}

/** Solde avant la première ligne (d'après la colonne Total) et solde final du fichier. */
export function fileBalances(rows: ImportRow[]): {
  opening: { cents: number; date: IsoDate } | null;
  closingFromFile: number | null;
  closingComputed: number | null;
} {
  const first = rows.find((r) => r.balanceCents !== null);
  if (!first) return { opening: null, closingFromFile: null, closingComputed: null };
  const firstIndex = rows.indexOf(first);
  const before = rows.slice(0, firstIndex).reduce((s, r) => s + r.cents, 0);
  const openingCents = first.balanceCents! - first.cents - before;
  const last = [...rows].reverse().find((r) => r.balanceCents !== null)!;
  return {
    opening: { cents: openingCents, date: rows[0]!.date },
    closingFromFile: last.balanceCents,
    closingComputed: openingCents + rows.reduce((s, r) => s + r.cents, 0),
  };
}

// ---------------------------------------------------------------------------
// Virements et lignes déjà enregistrées
// ---------------------------------------------------------------------------

const compact = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, "");

/**
 * Devine l'autre compte d'un virement d'après son nom dans le libellé :
 * « vers livretA », « livret A : essence », « recharge compte courant ».
 */
export function guessTransferAccount(label: string, accounts: Account[], currentAccountId: string): Account | null {
  const text = compact(label);
  let best: Account | null = null;
  for (const a of accounts) {
    if (a.id === currentAccountId || a.archivedAt) continue;
    const name = compact(a.name);
    if (name.length >= 4 && text.includes(name) && (!best || name.length > compact(best.name).length)) best = a;
  }
  return best;
}

function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Ligne existante minimale utilisée pour repérer les doublons. */
export type ExistingLine = Pick<Transaction, "id" | "date" | "amountCents" | "type" | "place" | "counterpartAccountId">;

/**
 * Repère les lignes du fichier déjà présentes sur le compte : même montant signé, même
 * date — ou jusqu'à 3 jours d'écart pour un virement (créé lors de l'import de l'autre
 * compte, parfois daté du jour de l'autre côté). Correspondance un pour un.
 */
export function matchExisting(
  rows: { key: string; date: IsoDate; cents: number }[],
  existing: ExistingLine[],
): Map<string, ExistingLine> {
  const matches = new Map<string, ExistingLine>();
  const used = new Set<string>();
  // d'abord les correspondances exactes (même jour), puis les écarts de date
  for (const pass of [0, 1, 2, 3]) {
    for (const row of rows) {
      if (matches.has(row.key)) continue;
      const hit = existing.find(
        (e) =>
          !used.has(e.id) &&
          e.amountCents === row.cents &&
          daysBetween(e.date, row.date) === pass &&
          (pass === 0 || e.type === "transfer"),
      );
      if (hit) {
        matches.set(row.key, hit);
        used.add(hit.id);
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Catégorisation automatique
// ---------------------------------------------------------------------------

/**
 * Règles par mots-clés (texte sans accents, en minuscules), vers les noms des catégories
 * par défaut. L'ordre compte : « uber eats » est un restaurant avant « uber » transport.
 */
const CATEGORY_RULES: [string, RegExp][] = [
  ["Salaire", /salaire|paie\b|prime d.activite|mobilijeune|\bcaf\b|13 ?e?me mois|allocation|pole emploi|france travail/],
  ["Restaurants", /uber ?eats|deliveroo|resto|restau|ristorante|osteria|trattoria|pizz|burger|kfc|mcdo|mc ?donald|five guys|subway|kebab|sushi|cafet|\bcafe\b|coffee|coffe|\bbar\b|brasserie|brasseur|pub\b|creperie|crepes?\b|snack|gelateria|glacier|boulangerie|viennoiserie|patisserie|bateleur|delirium|naga|sunbar|barstool|guinguette|gourmand|bouf+e?\b|miam\b|carte tr\b|ticket resto|traiteur/],
  ["Courses", /carr+efour|leclerc|intermarche|lidl|aldi|monoprix|franprix|auchan|casino|super ?u\b|superstore|biocoop|picard|grand frais|too good to go|marche\b|epicerie|drive\b|supermarche/],
  ["Transport", /essence|carburant|gasoil|diesel|station|peage|telepeage|parking|parcheggio|stationnement|paybyphone|sncf|ouigo|flixbus|blablacar|\buber\b|bolt|taxi|\bvtc\b|metro|\bbus\b|tisseo|navigo|ratp|tram|train|avion|ryanair|easyjet|velo|ridemovi|lime\b|maif|opteven|garage|carwash|lavage|controle technique|pneu|seat\b|norauto|feu vert/],
  ["Abonnements", /icloud|netflix|spotify|disney|amazon prime|prime video|deezer|canal\+?|free mobile|\bsfr\b|orange|bouygues|claude|chatgpt|openai|ionos|ovh|fitness|basic.?fit|salle de sport|abonnement|forfait mobile/],
  ["Santé", /pharmacie|medecin|docteur|\bdr\b|doctolib|ophtalmo|dentiste|kine|osteo|mutuelle|optique|opticien|lunettes|hopital|clinique|laboratoire/],
  ["Logement", /loyer|\bedf\b|engie|electricite|\beau\b|assurance habitation|charges|syndic|internet|\bbox\b|ikea|leroy merlin|castorama|laverie|pressing|machines/],
  ["Loisirs", /bowling|cinema|\bcine\b|escape|billard|laser|lazer|concert|festival|spectacle|musee|padel|\bski\b|forfait|location|parachute|skydive|jeux?\b|steam|fnac|cultura|voyage|airbnb|hotel|booking|linkin|soiree|tower|zoo|parc\b/],
];

export const INTEREST_PATTERN = /remuneration|interets?\b|interet/;

export function ruleCategoryName(label: string): string | null {
  const text = normalizeText(label);
  for (const [name, re] of CATEGORY_RULES) if (re.test(text)) return name;
  return null;
}

export interface Categorizer {
  /** Catégorie proposée pour un libellé, selon le sens (dépense / recette) */
  categoryFor(label: string, direction: "out" | "in"): string | null;
}

/**
 * Priorité : mémoire des lieux (dernière saisie au même libellé) → règles par mots-clés →
 * « Autres ». Une recette ne reçoit une règle que si elle vise une catégorie de revenu.
 */
export function createCategorizer(categories: Category[], memory: PlaceMemoryEntry[]): Categorizer {
  const active = categories.filter((c) => !c.archivedAt);
  const byName = new Map(active.map((c) => [normalizeText(c.name), c]));
  const byId = new Map(active.map((c) => [c.id, c]));
  const memoryByLabel = new Map(memory.map((m) => [normalizeText(m.place), m]));
  const fallbackOut = byName.get("autres") ?? active.find((c) => !c.isIncome) ?? null;
  const fallbackIn = byName.get("autres") ?? active.find((c) => c.isIncome) ?? fallbackOut;

  return {
    categoryFor(label, direction) {
      const remembered = memoryByLabel.get(normalizeText(label));
      const rememberedCat = remembered?.categoryId ? byId.get(remembered.categoryId) : undefined;
      if (rememberedCat && (direction === "in" || !rememberedCat.isIncome)) return rememberedCat.id;

      const ruleName = ruleCategoryName(label);
      const ruleCat = ruleName ? byName.get(normalizeText(ruleName)) : undefined;
      if (ruleCat && (direction === "out" ? !ruleCat.isIncome : ruleCat.isIncome)) return ruleCat.id;

      return (direction === "out" ? fallbackOut : fallbackIn)?.id ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Brouillon éditable (tableau de l'import) et plan d'import
// ---------------------------------------------------------------------------

/** Types proposés dans le tableau ; le sens du virement est explicite. */
export type DraftType = "out" | "in" | "interest" | "transfer_out" | "transfer_in";

export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  out: "Sortie",
  in: "Entrée",
  interest: "Intérêts",
  transfer_out: "Virement vers",
  transfer_in: "Virement depuis",
};

export interface DraftRow {
  key: string;
  /** Ligne d'origine dans le fichier (null = ligne ajoutée à la main) */
  line: number | null;
  include: boolean;
  date: string;
  type: DraftType;
  label: string;
  categoryId: string | null;
  /** Autre compte d'un virement */
  counterpartId: string | null;
  /** Montant saisi (positif), tel qu'affiché dans le champ */
  amount: string;
  /** Catégorie modifiée à la main (n'est plus propagée aux libellés identiques) */
  categoryManual: boolean;
  /** Ligne déjà enregistrée sur le compte (exclue par défaut) */
  existing: { date: IsoDate; place: string | null; type: Transaction["type"] } | null;
}

export const isTransferType = (t: DraftType) => t === "transfer_out" || t === "transfer_in";
export const isOutflow = (t: DraftType) => t === "out" || t === "transfer_out";

export function formatDraftAmount(cents: number): string {
  const abs = Math.abs(cents);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Transforme les lignes lues en brouillon : type, virement deviné, catégorie, doublons. */
export function buildDrafts(params: {
  rows: ImportRow[];
  account: Account;
  accounts: Account[];
  categorizer: Categorizer;
  existing: ExistingLine[];
}): DraftRow[] {
  const { rows, account, accounts, categorizer, existing } = params;
  const matches = matchExisting(
    rows.map((r) => ({ key: r.id, date: r.date, cents: r.cents })),
    existing,
  );
  return rows.map((r) => {
    const out = r.cents < 0;
    const other = guessTransferAccount(r.label, accounts, account.id);
    const interest = !out && account.type === "savings" && INTEREST_PATTERN.test(normalizeText(r.label));
    const type: DraftType = other ? (out ? "transfer_out" : "transfer_in") : out ? "out" : interest ? "interest" : "in";
    const match = matches.get(r.id);
    return {
      key: r.id,
      line: r.line,
      include: !match,
      date: r.date,
      type,
      label: r.label,
      categoryId: type === "out" || type === "in" ? categorizer.categoryFor(r.label, out ? "out" : "in") : null,
      counterpartId: other?.id ?? null,
      amount: formatDraftAmount(r.cents),
      categoryManual: false,
      existing: match ? { date: match.date, place: match.place, type: match.type } : null,
    };
  });
}

/** Ce qui empêche une ligne d'être importée (null = ligne valide). */
export function draftProblem(d: DraftRow, accountId: string): string | null {
  if (!isValidIsoDate(d.date)) return "Date invalide";
  const cents = parseImportAmount(d.amount);
  if (cents === null || cents <= 0) return "Montant requis";
  if (isTransferType(d.type)) {
    if (!d.counterpartId) return "Choisis l'autre compte";
    if (d.counterpartId === accountId) return "Choisis un autre compte";
    return null;
  }
  if (!d.label.trim()) return "Libellé requis";
  if ((d.type === "out" || d.type === "in") && !d.categoryId) return "Catégorie requise";
  return null;
}

/** Montant signé d'une ligne du point de vue du compte importé (0 si illisible). */
export function draftSignedCents(d: DraftRow): number {
  const cents = Math.abs(parseImportAmount(d.amount) ?? 0);
  return isOutflow(d.type) ? -cents : cents;
}

export type ImportItem =
  | { kind: "out" | "in" | "interest"; accountId: string; date: IsoDate; place: string; categoryId: string | null; amountCents: number; note: string | null }
  | { kind: "transfer"; accountId: string; toAccountId: string; date: IsoDate; place: string; amountCents: number; note: string | null };

/** Ligne valide → élément envoyé au serveur (un virement garde toujours source → destination). */
export function draftToItem(d: DraftRow, accountId: string): ImportItem {
  const amountCents = Math.abs(parseImportAmount(d.amount) ?? 0);
  const place = d.label.trim();
  if (isTransferType(d.type)) {
    const out = d.type === "transfer_out";
    return {
      kind: "transfer",
      accountId: out ? accountId : d.counterpartId!,
      toAccountId: out ? d.counterpartId! : accountId,
      date: d.date,
      place: place || "Virement",
      amountCents,
      note: null,
    };
  }
  return {
    kind: d.type as "out" | "in" | "interest",
    accountId,
    date: d.date,
    place,
    categoryId: d.type === "interest" ? null : d.categoryId,
    amountCents,
    note: null,
  };
}

/** Clé de déduplication d'une ligne (compte, date, montant signé, libellé). */
export function dedupeKey(accountId: string, date: string, signedCents: number, place: string | null): string {
  return `${accountId}|${date}|${signedCents}|${normalizeText(place ?? "")}`;
}
