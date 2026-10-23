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
  /**
   * Virement dont le libellé ne donne pas le nom du destinataire (« VIR. VERS MLLE ») : compté
   * en loyer seulement s'il fait exactement le loyer du mois et qu'aucun autre virement ne l'a payé.
   */
  unnamed?: boolean;
}

/** Nom du destinataire d'une clé de virement (« vir chouchounne » → « chouchounne » ; « vir » → ""). */
export const recipientName = (key: string) => key.replace(/^(vir|wero)(\s+|$)/, "").trim();

/** Virement sans nom de destinataire (la banque l'a tronqué) */
export const isUnnamedTransfer = (key: string) => key === "vir";

/**
 * Un virement est-il destiné à ce proche ? La banque tronque souvent le nom (« chou », « chouc »
 * pour « chouchounne ») : l'un des deux noms commence par l'autre, au moins 3 lettres.
 */
export function matchesRecipient(ruleKey: string, lineKey: string): boolean {
  const a = recipientName(ruleKey);
  const b = recipientName(lineKey);
  if (a.length < 3 || b.length < 3) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** Période en vigueur à une date (la dernière commencée), ou null avant la première. */
export function periodAt(periods: RentPeriod[], date: IsoDate): RentPeriod | null {
  let current: RentPeriod | null = null;
  for (const p of periods) if (p.start <= date && (!current || p.start > current.start)) current = p;
  return current;
}

/**
 * Part loyer de chaque virement (centimes, positive), par id. Chaque virement suit la période en
 * vigueur à sa date. En montant mensuel, dans un même mois (et une même période) : un virement qui
 * fait exactement le loyer est le loyer ; sinon les plus gros virements, jusqu'au montant fixé ; le
 * reste n'est pas du loyer. Un virement sans nom ne compte que s'il fait exactement le loyer.
 */
export function allocateRent(lines: RentLine[], periods: RentPeriod[]): Map<string, number> {
  const parts = new Map<string, number>();
  const buckets = new Map<string, { period: RentPeriod; lines: RentLine[] }>();
  for (const l of lines) {
    const period = periodAt(periods, l.date);
    if (!period || period.value <= 0) continue;
    if (period.mode === "percent") {
      if (l.unnamed) continue;
      const part = Math.round((l.cents * Math.min(100, period.value)) / 100);
      if (part > 0) parts.set(l.id, part);
      continue;
    }
    const key = `${period.start}|${l.date.slice(0, 7)}`;
    const bucket = buckets.get(key) ?? { period, lines: [] };
    bucket.lines.push(l);
    buckets.set(key, bucket);
  }
  const byDate = (a: RentLine, b: RentLine) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id));
  for (const { period, lines: month } of buckets.values()) {
    const rent = period.value;
    // un virement du montant exact du loyer, c'est le loyer (nommé de préférence, sinon sans nom)
    const exact = month.filter((l) => l.cents === rent).sort((a, b) => Number(!!a.unnamed) - Number(!!b.unnamed) || byDate(a, b))[0];
    if (exact) {
      parts.set(exact.id, rent);
      continue;
    }
    // sinon les plus gros virements nommés, jusqu'au montant
    let left = rent;
    for (const l of month.filter((x) => !x.unnamed).sort((a, b) => b.cents - a.cents || byDate(a, b))) {
      if (left <= 0) break;
      const part = Math.min(l.cents, left);
      parts.set(l.id, part);
      left -= part;
    }
  }
  return parts;
}

/** Libellé d'une période : « 450,00 € par mois », « 60 % de chaque virement » ou « plus de loyer ». */
export function describeRentPeriod(period: Pick<RentPeriod, "mode" | "value">, formatCents: (c: number) => string): string {
  if (period.value <= 0) return "plus de loyer";
  return period.mode === "monthly" ? `${formatCents(period.value)} par mois` : `${period.value} % de chaque virement`;
}
