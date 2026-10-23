/**
 * Loyer payé à un proche (loyer partagé) - logique pure. Une règle désigne le proche (clé
 * commerçant de ses virements, ex. « vir chouchounne ») et un historique de périodes : chacune
 * commence à une date et fixe la part de loyer, un montant par mois (« 450 € de mes virements à X
 * chaque mois ») ou un pourcentage de chaque virement, jusqu'au début de la période suivante.
 * Une période à 0 marque la fin du loyer (déménagement). La part loyer de chaque virement est
 * ensuite détachée en ligne « Logement ».
 */
import type { IsoDate } from "./dates";

export type RentMode = "monthly" | "percent";

export interface RentPeriod {
  /** Premier jour de la période (incluse) */
  start: IsoDate;
  mode: RentMode;
  /** monthly : centimes par mois ; percent : pourcentage (0 à 100) ; 0 = plus de loyer */
  value: number;
}

export interface RentLine {
  id: string;
  date: IsoDate;
  /** Montant du virement, positif */
  cents: number;
}

/** Période en vigueur à une date (la dernière commencée), ou null avant la première. */
export function periodAt(periods: RentPeriod[], date: IsoDate): RentPeriod | null {
  let current: RentPeriod | null = null;
  for (const p of periods) if (p.start <= date && (!current || p.start > current.start)) current = p;
  return current;
}

/**
 * Part loyer de chaque virement (centimes, positive), par id. Chaque virement suit la période en
 * vigueur à sa date. En montant mensuel, les virements d'un même mois (et d'une même période)
 * comptent dans l'ordre des dates jusqu'au montant fixé ; le reste n'est pas du loyer.
 */
export function allocateRent(lines: RentLine[], periods: RentPeriod[]): Map<string, number> {
  const parts = new Map<string, number>();
  const remaining = new Map<string, number>();
  const sorted = [...lines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)));
  for (const l of sorted) {
    const period = periodAt(periods, l.date);
    if (!period || period.value <= 0) continue;
    if (period.mode === "percent") {
      const part = Math.round((l.cents * Math.min(100, period.value)) / 100);
      if (part > 0) parts.set(l.id, part);
      continue;
    }
    const bucket = `${period.start}|${l.date.slice(0, 7)}`;
    const left = remaining.get(bucket) ?? period.value;
    const part = Math.min(l.cents, left);
    if (part > 0) parts.set(l.id, part);
    remaining.set(bucket, left - part);
  }
  return parts;
}

/** Libellé d'une période : « 450,00 € par mois », « 60 % de chaque virement » ou « plus de loyer ». */
export function describeRentPeriod(period: Pick<RentPeriod, "mode" | "value">, formatCents: (c: number) => string): string {
  if (period.value <= 0) return "plus de loyer";
  return period.mode === "monthly" ? `${formatCents(period.value)} par mois` : `${period.value} % de chaque virement`;
}
