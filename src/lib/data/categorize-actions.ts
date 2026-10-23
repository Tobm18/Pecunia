"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { autoCategorize, confirmTransactionCategory, createSuggestedCategories, validateMerchants } from "./categorize";
import { getSession } from "./queries";

/** Actions du classement : catégories proposées, validation des lignes à vérifier. */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const refresh = () => revalidatePath("/", "layout");

export async function createCategoriesFromSuggestions(names: string[]): Promise<ActionResult<{ created: number }>> {
  const parsed = z.array(z.string().max(60)).max(20).safeParse(names);
  if (!parsed.success) return { ok: false, error: "Choix invalide." };
  const { user } = await getSession();
  try {
    const created = await createSuggestedCategories(user.id, parsed.data);
    // les nouvelles catégories servent aussitôt au classement automatique
    await autoCategorize(user.id, { lookupBudget: 0 });
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

/** Valide la catégorie de commerçants à vérifier (retenue pour leurs prochaines lignes). */
export async function validateMerchantCategories(items: z.input<typeof itemsInput>): Promise<ActionResult<{ changed: number }>> {
  const parsed = itemsInput.safeParse(items);
  if (!parsed.success) return { ok: false, error: "Choix invalide." };
  const { user } = await getSession();
  try {
    const changed = await validateMerchants(user.id, parsed.data);
    // d'autres commerçants peuvent en profiter (même racine, ex. tous les péages ESCOTA)
    after(() => autoCategorize(user.id, { lookupBudget: 0 }).catch(() => undefined));
    refresh();
    return { ok: true, data: { changed } };
  } catch {
    return { ok: false, error: "Validation impossible, réessaie dans un instant." };
  }
}

/** Confirme la catégorie d'une ligne telle quelle. */
export async function confirmCategory(transactionId: string): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(transactionId).success) return { ok: false, error: "Ligne inconnue." };
  const { user } = await getSession();
  const done = await confirmTransactionCategory(user.id, transactionId).catch(() => false);
  if (!done) return { ok: false, error: "Confirmation impossible, réessaie dans un instant." };
  after(() => autoCategorize(user.id, { lookupBudget: 0 }).catch(() => undefined));
  refresh();
  return { ok: true, data: undefined };
}
