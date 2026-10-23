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
 * Part loyer de chaque virement (centimes, positive), par id. En pourcentage, chaque virement suit la
 * période en vigueur à sa date. En montant mensuel, le loyer de chaque mois est payé : d'abord par
 * les virements du mois (le montant exact s'il existe, sinon les plus gros) ; puis par l'excédent
 * d'un virement du mois précédent (loyer payé d'avance) ; enfin par celui du mois suivant
 * (rattrapage). Le reste n'est pas du loyer. Un virement sans nom ne compte que s'il fait
 * exactement le loyer de son mois.
 */
export function allocateRent(lines: RentLine[], periods: RentPeriod[]): Map<string, number> {
  const parts = new Map<string, number>();
  const add = (id: string, cents: number) => parts.set(id, (parts.get(id) ?? 0) + cents);
  const monthly: RentLine[] = [];
  for (const l of lines) {
    const period = periodAt(periods, l.date);
    if (!period || period.value <= 0) continue;
    if (period.mode === "percent") {
      if (l.unnamed) continue;
      const part = Math.round((l.cents * Math.min(100, period.value)) / 100);
      if (part > 0) add(l.id, part);
      continue;
    }
    monthly.push(l);
  }
  if (!monthly.length) return parts;

  const byDate = (a: RentLine, b: RentLine) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id));
  const monthOf = (date: string) => date.slice(0, 7);
  const shift = (month: string, delta: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  // loyer dû chaque mois : celui de la période en vigueur en fin de mois (mode mensuel uniquement)
  const dueOf = (month: string) => {
    const p = periodAt(periods, `${month}-31`);
    return p && p.mode === "monthly" ? Math.max(0, p.value) : 0;
  };
  const sorted = [...monthly].sort(byDate);
  const due = new Map<string, number>();
  for (let m = monthOf(sorted[0]!.date); m <= monthOf(sorted.at(-1)!.date); m = shift(m, 1)) due.set(m, dueOf(m));
  const capacity = new Map(sorted.map((l) => [l.id, l.cents]));
  const pay = (l: RentLine, month: string, max = Infinity) => {
    const amount = Math.min(capacity.get(l.id) ?? 0, due.get(month) ?? 0, max);
    if (amount <= 0) return;
    add(l.id, amount);
    capacity.set(l.id, capacity.get(l.id)! - amount);
    due.set(month, due.get(month)! - amount);
  };

  // 1. chaque mois avec ses propres virements : le montant exact d'abord (nommé de préférence),
  //    sinon les plus gros virements nommés jusqu'au loyer
  const byMonth = new Map<string, RentLine[]>();
  for (const l of sorted) byMonth.set(monthOf(l.date), [...(byMonth.get(monthOf(l.date)) ?? []), l]);
  for (const [month, own] of byMonth) {
    const rent = due.get(month) ?? 0;
    if (rent <= 0) continue;
    const exact = own.filter((l) => l.cents === rent).sort((a, b) => Number(!!a.unnamed) - Number(!!b.unnamed) || byDate(a, b))[0];
    if (exact) {
      pay(exact, month);
      continue;
    }
    for (const l of own.filter((x) => !x.unnamed).sort((a, b) => b.cents - a.cents || byDate(a, b))) pay(l, month);
  }
  // 2. loyer payé d'avance : l'excédent d'un virement couvre le mois suivant encore impayé
  for (const l of sorted) if (!l.unnamed) pay(l, shift(monthOf(l.date), 1));
  // 3. rattrapage : l'excédent restant complète le mois précédent
  for (const l of sorted) if (!l.unnamed) pay(l, shift(monthOf(l.date), -1));
  return parts;
}

/** Libellé d'une période : « 450,00 € par mois », « 60 % de chaque virement » ou « plus de loyer ». */
export function describeRentPeriod(period: Pick<RentPeriod, "mode" | "value">, formatCents: (c: number) => string): string {
  if (period.value <= 0) return "plus de loyer";
  return period.mode === "monthly" ? `${formatCents(period.value)} par mois` : `${period.value} % de chaque virement`;
}
