"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { autoCategorize, confirmTransactionCategory, createSuggestedCategories, recategorize, similarTransactions, validateMerchants } from "./categorize";
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

/** Nombre de lignes similaires (même commerçant, même sens) à une transaction, elle comprise. */
export async function getSimilarCount(transactionId: string): Promise<ActionResult<{ merchantKey: string; count: number }>> {
  if (!z.string().uuid().safeParse(transactionId).success) return { ok: false, error: "Ligne inconnue." };
  const { user } = await getSession();
  const { merchantKey, ids } = await similarTransactions(user.id, transactionId);
  return { ok: true, data: { merchantKey, count: ids.length } };
}

/** Applique une catégorie à toutes les lignes similaires à une transaction (même commerçant, même sens). */
export async function applyCategoryToSimilar(transactionId: string, categoryId: string): Promise<ActionResult<{ changed: number }>> {
  if (!z.string().uuid().safeParse(transactionId).success || !z.string().uuid().safeParse(categoryId).success) {
    return { ok: false, error: "Choix invalide." };
  }
  const { user } = await getSession();
  try {
    const { ids } = await similarTransactions(user.id, transactionId);
    const changed = await recategorize(user.id, ids, categoryId);
    refresh();
    return { ok: true, data: { changed } };
  } catch {
    return { ok: false, error: "Reclassement impossible, réessaie dans un instant." };
  }
}

/** Reclasse une liste de lignes (résultat d'une recherche ou d'un filtre) dans une catégorie. */
export async function recategorizeTransactions(ids: string[], categoryId: string): Promise<ActionResult<{ changed: number }>> {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(5000), categoryId: z.string().uuid() }).safeParse({ ids, categoryId });
  if (!parsed.success) return { ok: false, error: "Choix invalide." };
  const { user } = await getSession();
  try {
    const changed = await recategorize(user.id, parsed.data.ids, parsed.data.categoryId);
    refresh();
    return { ok: true, data: { changed } };
  } catch {
    return { ok: false, error: "Reclassement impossible, réessaie dans un instant." };
  }
}
