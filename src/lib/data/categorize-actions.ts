"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { applyMerchantCategories, createSuggestedCategories } from "./categorize";
import { getSession } from "./queries";

/** Actions de l'écran « Classer mes transactions » (Catégories). */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const refresh = () => revalidatePath("/", "layout");

export async function createCategoriesFromSuggestions(names: string[]): Promise<ActionResult<{ created: number }>> {
  const parsed = z.array(z.string().max(60)).max(20).safeParse(names);
  if (!parsed.success) return { ok: false, error: "Choix invalide." };
  const { user } = await getSession();
  try {
    const created = await createSuggestedCategories(user.id, parsed.data);
    refresh();
    return { ok: true, data: { created } };
  } catch {
    return { ok: false, error: "Création impossible, réessaie dans un instant." };
  }
}

const itemsInput = z
  .array(z.object({ merchantKey: z.string().min(1).max(120), direction: z.enum(["out", "in"]), categoryId: z.string().uuid() }))
  .min(1)
  .max(2000);

export async function classifyMerchants(items: z.input<typeof itemsInput>): Promise<ActionResult<{ changed: number }>> {
  const parsed = itemsInput.safeParse(items);
  if (!parsed.success) return { ok: false, error: "Choix invalide." };
  const { user } = await getSession();
  try {
    const changed = await applyMerchantCategories(user.id, parsed.data);
    refresh();
    return { ok: true, data: { changed } };
  } catch {
    return { ok: false, error: "Classement impossible, réessaie dans un instant." };
  }
}
