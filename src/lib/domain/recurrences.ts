/**
 * Récurrences : génération des échéances et rapprochement avec les transactions.
 *
 * Une échéance est « réalisée » si une transaction lui correspond :
 *  - soit liée explicitement (transaction.recurrenceId = récurrence, validée par le ✓) ;
 *  - soit déjà saisie ou importée sans lien : même compte, même sens, libellé proche et
 *    montant proche (±10 %, au moins 1 €), dans la fenêtre de l'échéance.
 */
import type { Recurrence, RecurrenceFrequency, Transaction } from "./types";
import { daysInMonth, type IsoDate } from "./dates";
import { normalizeText } from "./csv-import";

const pad = (n: number) => String(n).padStart(2, "0");

export const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  weekly: "Chaque semaine",
  monthly: "Chaque mois",
  quarterly: "Chaque trimestre",
  yearly: "Chaque année",
};

/** Période approximative (jours) : fenêtre de rapprochement = ± moitié. */
const PERIOD_DAYS: Record<RecurrenceFrequency, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };

/** Équivalent mensuel d'un montant récurrent (coût mensualisé des abonnements). */
export function monthlyEquivalentCents(r: Pick<Recurrence, "amountCents" | "frequency">): number {
  switch (r.frequency) {
    case "weekly":
      return Math.round((r.amountCents * 52) / 12);
    case "quarterly":
      return Math.round(r.amountCents / 3);
    case "yearly":
      return Math.round(r.amountCents / 12);
    default:
      return r.amountCents;
  }
}

function dayOf(date: IsoDate): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}

function fromDay(day: number): IsoDate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Échéance du mois (y, m) : jour d'échéance ramené au dernier jour du mois. */
function monthlyDate(y: number, m: number, dueDay: number): IsoDate {
  return `${y}-${pad(m)}-${pad(Math.min(dueDay, daysInMonth(y, m)))}`;
}

/** Dates d'échéance d'une récurrence dans [from, to] (bornes incluses), triées. */
export function occurrenceDates(r: Recurrence, from: IsoDate, to: IsoDate): IsoDate[] {
  const start = r.startDate > from ? r.startDate : from;
  const end = r.endDate && r.endDate < to ? r.endDate : to;
  if (start > end) return [];
  const out: IsoDate[] = [];

  if (r.frequency === "weekly") {
    const first = dayOf(r.startDate);
    const lo = dayOf(start);
    const k = Math.max(0, Math.ceil((lo - first) / 7));
    for (let d = first + k * 7; d <= dayOf(end); d += 7) out.push(fromDay(d));
    return out;
  }

  const step = r.frequency === "monthly" ? 1 : r.frequency === "quarterly" ? 3 : 12;
  const [sy, sm] = r.startDate.split("-").map(Number) as [number, number];
  const [ey, em] = end.split("-").map(Number) as [number, number];
  // on part du mois de départ et on avance par pas jusqu'à la fin de fenêtre
  for (let i = 0; ; i += step) {
    const idx = sy * 12 + (sm - 1) + i;
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    if (y * 12 + m > ey * 12 + em) break;
    const date = monthlyDate(y, m, r.dueDay);
    if (date >= start && date <= end) out.push(date);
  }
  return out;
}

/** Montant signé du point de vue du compte source (sortie et virement négatifs). */
export function signedRecurrenceCents(r: Pick<Recurrence, "type" | "amountCents">): number {
  return r.type === "in" ? r.amountCents : -r.amountCents;
}

export interface Occurrence {
  key: string;
  recurrence: Recurrence;
  date: IsoDate;
  status: "planned" | "done";
  /** Transaction qui réalise l'échéance (liée ou reconnue) */
  transaction: Transaction | null;
  /** Reconnue automatiquement (sans lien explicite) */
  matched: boolean;
}

const labelsClose = (a: string, b: string) => {
  const x = normalizeText(a).replace(/[^a-z0-9]+/g, " ").trim();
  const y = normalizeText(b).replace(/[^a-z0-9]+/g, " ").trim();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/**
 * Échéances de plusieurs récurrences sur une période, avec leur statut. `txs` doit couvrir
 * la période élargie d'une demi-période de chaque côté.
 */
export function buildOccurrences(recurrences: Recurrence[], txs: Transaction[], from: IsoDate, to: IsoDate): Occurrence[] {
  const used = new Set<string>();
  const result: Occurrence[] = [];

  // 1) liens explicites d'abord
  const pending: Occurrence[] = [];
  for (const r of recurrences) {
    const half = PERIOD_DAYS[r.frequency] / 2;
    for (const date of occurrenceDates(r, from, to)) {
      const occ: Occurrence = { key: `${r.id}|${date}`, recurrence: r, date, status: "planned", transaction: null, matched: false };
      const linked = txs
        .filter((t) => t.recurrenceId === r.id && t.accountId === r.accountId && !used.has(t.id))
        .filter((t) => Math.abs(dayOf(t.date) - dayOf(date)) <= half)
        .sort((a, b) => Math.abs(dayOf(a.date) - dayOf(date)) - Math.abs(dayOf(b.date) - dayOf(date)))[0];
      if (linked) {
        used.add(linked.id);
        occ.status = "done";
        occ.transaction = linked;
      }
      result.push(occ);
      if (!linked) pending.push(occ);
    }
  }

  // 2) puis reconnaissance des transactions saisies ou importées sans lien
  for (const occ of pending) {
    const r = occ.recurrence;
    const half = PERIOD_DAYS[r.frequency] / 2;
    const expected = signedRecurrenceCents(r);
    const tolerance = Math.max(100, Math.round(r.amountCents * 0.1));
    const candidate = txs
      .filter(
        (t) =>
          !used.has(t.id) &&
          !t.recurrenceId &&
          t.accountId === r.accountId &&
          (r.type === "transfer" ? t.type === "transfer" && t.counterpartAccountId === r.toAccountId : t.type === r.type) &&
          Math.sign(t.amountCents) === Math.sign(expected) &&
          Math.abs(t.amountCents - expected) <= tolerance &&
          Math.abs(dayOf(t.date) - dayOf(occ.date)) <= half &&
          (r.type === "transfer" || labelsClose(t.place ?? "", r.label)),
      )
      .sort((a, b) => Math.abs(dayOf(a.date) - dayOf(occ.date)) - Math.abs(dayOf(b.date) - dayOf(occ.date)))[0];
    if (candidate) {
      used.add(candidate.id);
      occ.status = "done";
      occ.transaction = candidate;
      occ.matched = true;
    }
  }

  return result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.recurrence.label.localeCompare(b.recurrence.label)));
}

/** Fenêtre de transactions à charger autour d'une période pour le rapprochement. */
export function occurrenceWindow(from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: fromDay(dayOf(from) - 190), to: fromDay(dayOf(to) + 190) };
}

export function isActiveOn(r: Recurrence, date: IsoDate): boolean {
  return r.startDate <= date && (!r.endDate || r.endDate >= date);
}
