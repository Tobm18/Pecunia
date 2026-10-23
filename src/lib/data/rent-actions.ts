"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmountToCents } from "@/lib/domain/money";
import { deleteRentRule, saveRentRule } from "./rent";
import { getSession } from "./queries";

/** Actions du loyer payé à un proche (page Catégories). */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const refresh = () => revalidatePath("/", "layout");

const ruleInput = z.object({
  merchantKey: z.string().trim().min(3).max(120),
  mode: z.enum(["monthly", "percent"]),
  value: z.string().trim().min(1).max(20),
  categoryId: z.string().uuid(),
});

export async function saveRent(input: z.input<typeof ruleInput>): Promise<ActionResult> {
  const parsed = ruleInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choisis le proche, la part et la catégorie." };
  const { merchantKey, mode, value, categoryId } = parsed.data;
  let amount: number | null;
  if (mode === "monthly") {
    amount = parseAmountToCents(value);
    if (amount === null || amount <= 0) return { ok: false, error: "Montant mensuel invalide." };
  } else {
    amount = Number(value.replace(",", "."));
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) return { ok: false, error: "Pourcentage entre 1 et 100." };
  }
  const { user } = await getSession();
  try {
    await saveRentRule(user.id, { merchantKey, mode, value: amount, categoryId });
  } catch {
    return { ok: false, error: "Enregistrement impossible, réessaie dans un instant." };
  }
  refresh();
  return { ok: true, data: undefined };
}

export async function removeRent(ruleId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(ruleId).success) return { ok: false, error: "Règle inconnue." };
  const { user } = await getSession();
  try {
    await deleteRentRule(user.id, ruleId);
  } catch {
    return { ok: false, error: "Suppression impossible, réessaie dans un instant." };
  }
  refresh();
  return { ok: true, data: undefined };
}
