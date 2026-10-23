"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isValidIsoDate } from "@/lib/domain/dates";
import { parseAmountToCents } from "@/lib/domain/money";
import type { RentPeriod } from "@/lib/domain/rent";
import { addRentPeriod, createRentRule, deleteRentPeriod, deleteRentRule, setRentCategory } from "./rent";
import { getSession } from "./queries";

/** Actions du loyer payé à un proche (page Catégories). */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const refresh = () => revalidatePath("/", "layout");
const uuid = z.string().uuid();
const done = (): ActionResult => {
  refresh();
  return { ok: true, data: undefined };
};
const failed = (): ActionResult => ({ ok: false, error: "Enregistrement impossible, réessaie dans un instant." });

const periodInput = z.object({
  start: z.string().refine(isValidIsoDate, "Date de début invalide."),
  mode: z.enum(["monthly", "percent"]),
  /** Montant en euros (mensuel) ou pourcentage ; « 0 » : plus de loyer à partir de cette date */
  value: z.string().trim().min(1).max(20),
});

/** Période saisie → période enregistrable, ou message d'erreur. */
function toPeriod(input: z.input<typeof periodInput>): RentPeriod | string {
  const parsed = periodInput.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Période invalide.";
  const { start, mode, value } = parsed.data;
  if (mode === "monthly") {
    const cents = parseAmountToCents(value);
    if (cents === null || cents < 0) return "Montant mensuel invalide.";
    return { start, mode, value: cents };
  }
  const pct = Number(value.replace(",", "."));
  if (!Number.isInteger(pct) || pct < 0 || pct > 100) return "Pourcentage entre 0 et 100.";
  return { start, mode, value: pct };
}

export async function createRent(input: { merchantKey: string; categoryId: string; period: z.input<typeof periodInput> }): Promise<ActionResult> {
  if (!z.string().trim().min(3).max(120).safeParse(input.merchantKey).success || !uuid.safeParse(input.categoryId).success) {
    return { ok: false, error: "Choisis le proche et la catégorie." };
  }
  const period = toPeriod(input.period);
  if (typeof period === "string") return { ok: false, error: period };
  const { user } = await getSession();
  return createRentRule(user.id, { merchantKey: input.merchantKey.trim(), categoryId: input.categoryId, period }).then(done, failed);
}

export async function addPeriod(ruleId: string, input: z.input<typeof periodInput>): Promise<ActionResult> {
  if (!uuid.safeParse(ruleId).success) return { ok: false, error: "Règle inconnue." };
  const period = toPeriod(input);
  if (typeof period === "string") return { ok: false, error: period };
  const { user } = await getSession();
  return addRentPeriod(user.id, ruleId, period).then(done, failed);
}

export async function removePeriod(periodId: string): Promise<ActionResult> {
  if (!uuid.safeParse(periodId).success) return { ok: false, error: "Période inconnue." };
  const { user } = await getSession();
  return deleteRentPeriod(user.id, periodId).then(done, failed);
}

export async function changeRentCategory(ruleId: string, categoryId: string): Promise<ActionResult> {
  if (!uuid.safeParse(ruleId).success || !uuid.safeParse(categoryId).success) return { ok: false, error: "Choix invalide." };
  const { user } = await getSession();
  return setRentCategory(user.id, ruleId, categoryId).then(done, failed);
}

export async function removeRent(ruleId: string): Promise<ActionResult> {
  if (!uuid.safeParse(ruleId).success) return { ok: false, error: "Règle inconnue." };
  const { user } = await getSession();
  return deleteRentRule(user.id, ruleId).then(done, failed);
}
