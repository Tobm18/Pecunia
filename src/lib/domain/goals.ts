/**
 * Objectifs d'épargne : « En avance » si les virements programmés chaque mois vers le
 * compte suffisent à atteindre la cible à la date prévue, sinon « En retard ».
 */
import type { Goal, Recurrence } from "./types";
import type { IsoDate } from "./dates";
import { isActiveOn, monthlyEquivalentCents } from "./recurrences";

export interface GoalStatus {
  goal: Goal;
  currentCents: number;
  remainingCents: number;
  monthsLeft: number;
  /** Montant à épargner chaque mois pour tenir l'échéance */
  neededPerMonthCents: number;
  /** Virements récurrents nets vers le compte, mensualisés */
  plannedPerMonthCents: number;
  onTrack: boolean;
  /** 0–1 */
  progress: number;
  /** Manque à l'échéance au rythme programmé (0 si à l'heure) */
  shortfallCents: number;
}

/** Nombre de mois (au moins 1) entre aujourd'hui et la date cible. */
export function monthsUntil(today: IsoDate, target: IsoDate): number {
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const [gy, gm, gd] = target.split("-").map(Number) as [number, number, number];
  let months = (gy - ty) * 12 + (gm - tm);
  if (gd < td) months -= 1;
  return Math.max(1, months);
}

/** Virements récurrents nets vers un compte, en équivalent mensuel. */
export function plannedMonthlyTransfers(accountId: string, recurrences: Recurrence[], today: IsoDate): number {
  return recurrences.reduce((sum, r) => {
    if (r.type !== "transfer" || !isActiveOn(r, today)) return sum;
    if (r.toAccountId === accountId) return sum + monthlyEquivalentCents(r);
    if (r.accountId === accountId) return sum - monthlyEquivalentCents(r);
    return sum;
  }, 0);
}

export function goalStatus(goal: Goal, currentCents: number, recurrences: Recurrence[], today: IsoDate): GoalStatus {
  const remainingCents = Math.max(0, goal.targetCents - currentCents);
  const monthsLeft = monthsUntil(today, goal.targetDate);
  const neededPerMonthCents = Math.ceil(remainingCents / monthsLeft);
  const plannedPerMonthCents = plannedMonthlyTransfers(goal.accountId, recurrences, today);
  const onTrack = remainingCents === 0 || plannedPerMonthCents >= neededPerMonthCents;
  return {
    goal,
    currentCents,
    remainingCents,
    monthsLeft,
    neededPerMonthCents,
    plannedPerMonthCents,
    onTrack,
    progress: goal.targetCents > 0 ? Math.max(0, Math.min(1, currentCents / goal.targetCents)) : 0,
    shortfallCents: onTrack ? 0 : remainingCents - Math.max(0, plannedPerMonthCents) * monthsLeft,
  };
}
