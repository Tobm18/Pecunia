/**
 * Dates métier manipulées en chaînes ISO « YYYY-MM-DD » (pas de fuseau horaire) et
 * mois en clés « YYYY-MM ».
 *
 * « Début du mois » (paramètre 1–28) : le mois budgétaire M commence le jour J du mois
 * précédent quand J > 1. Ex. J = 25 → « octobre 2026 » = 25 sept. → 24 oct. (la majorité
 * des jours tombe en octobre, et le salaire versé le 25 sept. finance octobre).
 */

export type MonthKey = string; // YYYY-MM
export type IsoDate = string; // YYYY-MM-DD

const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];
const MONTHS_SHORT = [
  "janv.", "févr.", "mars", "avr.", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];
const MONTHS_ABBR = ["Janv", "Févr", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const pad = (n: number) => String(n).padStart(2, "0");
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function parseMonth(key: MonthKey): [number, number] {
  const [y, m] = key.split("-").map(Number);
  return [y!, m!];
}

function parseDate(iso: IsoDate): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y!, m!, d!];
}

export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Date du jour dans le fuseau local de l'appareil */
export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function addMonths(key: MonthKey, delta: number): MonthKey {
  const [y, m] = parseMonth(key);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

export function compareMonths(a: MonthKey, b: MonthKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Période [start, end] (bornes incluses) du mois budgétaire. */
export function monthPeriod(key: MonthKey, startDay = 1): { start: IsoDate; end: IsoDate } {
  const [y, m] = parseMonth(key);
  if (startDay <= 1) {
    return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(daysInMonth(y, m))}` };
  }
  const prev = addMonths(key, -1);
  return { start: `${prev}-${pad(startDay)}`, end: `${key}-${pad(startDay - 1)}` };
}

/** Mois budgétaire auquel appartient une date. */
export function monthKeyOf(date: IsoDate, startDay = 1): MonthKey {
  const [y, m, d] = parseDate(date);
  const key = `${y}-${pad(m)}`;
  return startDay > 1 && d >= startDay ? addMonths(key, 1) : key;
}

export function isInPeriod(date: IsoDate, period: { start: IsoDate; end: IsoDate }): boolean {
  return date >= period.start && date <= period.end;
}

/** Les n derniers mois se terminant par `last` (inclus), du plus ancien au plus récent. */
export function lastMonths(last: MonthKey, n: number): MonthKey[] {
  return Array.from({ length: n }, (_, i) => addMonths(last, i - (n - 1)));
}

/** « 2026-09 » → « Septembre 2026 » */
export function monthLabel(key: MonthKey): string {
  const [y, m] = parseMonth(key);
  return `${capitalize(MONTHS[m - 1]!)} ${y}`;
}

/** « 2026-09 » → « Sept » (axes de graphiques) */
export function monthAbbr(key: MonthKey): string {
  return MONTHS_ABBR[parseMonth(key)[1] - 1]!;
}

/** « 2026-09 » → « septembre » */
export function monthName(key: MonthKey): string {
  return MONTHS[parseMonth(key)[1] - 1]!;
}

/** « 2026-09-28 » → « Lundi 28 septembre » */
export function dayLabel(date: IsoDate): string {
  const [y, m, d] = parseDate(date);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()]!;
  return `${capitalize(weekday)} ${d} ${MONTHS[m - 1]}`;
}

/** « 2026-09-28 » → « 28 sept. » */
export function shortDate(date: IsoDate): string {
  const [, m, d] = parseDate(date);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** « 2026-09-28 » → « 28/09/2026 » */
export function numericDate(date: IsoDate): string {
  const [y, m, d] = parseDate(date);
  return `${pad(d)}/${pad(m)}/${y}`;
}

/** « 2026-09-28 » → « 28 septembre » */
export function longDayMonth(date: IsoDate): string {
  const [, m, d] = parseDate(date);
  return `${d} ${MONTHS[m - 1]}`;
}

export function isValidMonthKey(value: string | undefined | null): value is MonthKey {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidIsoDate(value: string | undefined | null): value is IsoDate {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = parseDate(value);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}
