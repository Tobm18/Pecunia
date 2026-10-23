/**
 * Loyer payé à un proche (loyer partagé) - logique pure. Une règle désigne le proche (clé
 * commerçant de ses virements, ex. « vir chouchounne ») et la part de loyer : un montant par mois
 * (« 450 € de mes virements à X chaque mois ») ou un pourcentage de chaque virement. La part loyer
 * de chaque virement est ensuite détachée en ligne « Logement ».
 */
import type { IsoDate } from "./dates";

export type RentMode = "monthly" | "percent";

export interface RentRule {
  mode: RentMode;
  /** monthly : centimes par mois ; percent : pourcentage (1 à 100) */
  value: number;
}

export interface RentLine {
  id: string;
  date: IsoDate;
  /** Montant du virement, positif */
  cents: number;
}

/**
 * Part loyer de chaque virement (centimes, positive), par id. En montant mensuel, les virements
 * d'un même mois comptent dans l'ordre des dates jusqu'au montant fixé ; le reste n'est pas du loyer.
 */
export function allocateRent(lines: RentLine[], rule: RentRule): Map<string, number> {
  const parts = new Map<string, number>();
  if (rule.value <= 0) return parts;
  if (rule.mode === "percent") {
    const pct = Math.min(100, rule.value);
    for (const l of lines) {
      const part = Math.round((l.cents * pct) / 100);
      if (part > 0) parts.set(l.id, part);
    }
    return parts;
  }
  const remainingByMonth = new Map<string, number>();
  for (const l of [...lines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)))) {
    const month = l.date.slice(0, 7);
    const remaining = remainingByMonth.get(month) ?? rule.value;
    const part = Math.min(l.cents, remaining);
    if (part > 0) parts.set(l.id, part);
    remainingByMonth.set(month, remaining - part);
  }
  return parts;
}

/** Libellé d'une règle : « 450,00 € par mois » ou « 60 % de chaque virement ». */
export function describeRentRule(rule: RentRule, formatCents: (c: number) => string): string {
  return rule.mode === "monthly" ? `${formatCents(rule.value)} par mois` : `${rule.value} % de chaque virement`;
}
