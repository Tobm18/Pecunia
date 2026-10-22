"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BankApiError, startAuthorization } from "@/lib/bank/enable-banking";
import { createPendingConnection, disconnectAll, linkBankAccount as link, syncConnection } from "./bank";
import { getBankOverview } from "./bank";
import { getSession } from "./queries";

/** Actions de l'écran « Banque » (Paramètres) : connexion, liaison des comptes, synchronisation. */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

const refresh = () => revalidatePath("/", "layout");

/** Démarre le consentement : renvoie l'adresse de la banque où se rendre. */
export async function connectBank(): Promise<ActionResult<{ url: string }>> {
  const { user } = await getSession();
  try {
    const state = crypto.randomUUID();
    const { url, validUntil } = await startAuthorization({ state });
    await createPendingConnection(user.id, state, validUntil);
    return ok({ url });
  } catch (error) {
    return fail(error instanceof BankApiError ? error.message : "Connexion à la banque impossible, réessaie dans un instant.");
  }
}

const linkInput = z.object({ bankAccountId: z.string().uuid(), target: z.union([z.string().uuid(), z.literal("new"), z.null()]) });

/** Relie un compte bancaire à un compte Pecunia (existant, ou créé à la volée), ou le délie. */
export async function linkBankAccount(input: { bankAccountId: string; target: string | null }): Promise<ActionResult> {
  const parsed = linkInput.safeParse(input);
  if (!parsed.success) return fail("Choix invalide.");
  const { user } = await getSession();
  const result = await link(user.id, parsed.data.bankAccountId, parsed.data.target);
  if (!result.ok) return fail(result.error);
  refresh();
  return ok(undefined);
}

/** Synchronise maintenant les comptes reliés. */
export async function syncBank(): Promise<ActionResult<{ inserted: number; accounts: number }>> {
  const { user } = await getSession();
  const overview = await getBankOverview(user.id);
  if (!overview.connection) return fail("Aucune banque connectée.");
  const result = await syncConnection(user.id, overview.connection.id);
  refresh();
  return result.ok ? ok(result.summary) : fail(result.error);
}

/** Retire la connexion (et le consentement chez Enable Banking) ; les transactions importées restent. */
export async function disconnectBank(): Promise<ActionResult> {
  const { user } = await getSession();
  try {
    await disconnectAll(user.id);
  } catch {
    return fail("Déconnexion impossible, réessaie dans un instant.");
  }
  refresh();
  return ok(undefined);
}
