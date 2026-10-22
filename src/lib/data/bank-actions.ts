"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BankApiError, startAuthorization } from "@/lib/bank/enable-banking";
import { isValidIsoDate, todayIso } from "@/lib/domain/dates";
import { parseAmountToCents } from "@/lib/domain/money";
import {
  addInterest as insertInterest,
  createPendingConnection,
  disconnectAll,
  getBankOverview,
  linkBankAccount as link,
  saveInternalAccount as saveInternal,
  syncConnection,
} from "./bank";
import { getSession } from "./queries";

/**
 * Actions de l'écran « Banque » (Paramètres) : connexion, liaison des comptes, synchronisation,
 * comptes internes suivis par les virements, intérêts d'épargne.
 */

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

const internalInput = z.object({
  accountId: z.string().uuid(),
  identifier: z.string().trim().max(40),
  keyword: z.string().trim().max(60),
  keywordIn: z.string().trim().max(60),
  balance: z.string().trim().max(20),
  balanceDate: z.string().refine((d) => d === "" || isValidIsoDate(d), "Date invalide."),
});

/**
 * Compte interne (livret…) : identifiant reconnu dans les virements du compte synchronisé et solde
 * réel connu à une date. Les virements déjà importés sont aussitôt reconnus.
 */
export async function saveInternalAccount(input: z.input<typeof internalInput>): Promise<ActionResult<{ converted: number }>> {
  const parsed = internalInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Valeurs invalides.");
  const { accountId, identifier, keyword, keywordIn, balance, balanceDate } = parsed.data;
  const balanceCents = balance ? parseAmountToCents(balance) : null;
  if (balance && balanceCents === null) return fail("Solde invalide.");
  if (balanceCents !== null && !balanceDate) return fail("Indique la date de ce solde.");
  if (balanceDate && balanceDate > todayIso()) return fail("La date ne peut pas être dans le futur.");
  const { user } = await getSession();
  const result = await saveInternal(user.id, { accountId, identifier: identifier || null, keyword: keyword || null, keywordIn: keywordIn || null, balanceCents, balanceDate: balanceCents !== null ? balanceDate : null });
  if (!result.ok) return fail(result.error);
  refresh();
  return ok({ converted: result.converted });
}

const interestInput = z.object({ accountId: z.string().uuid(), amount: z.string().trim().min(1), date: z.string().refine(isValidIsoDate, "Date invalide.") });

/** Intérêts annuels d'un compte épargne, saisis à la main (versés sans passer par le compte courant). */
export async function addInterest(input: z.input<typeof interestInput>): Promise<ActionResult> {
  const parsed = interestInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Valeurs invalides.");
  const cents = parseAmountToCents(parsed.data.amount);
  if (cents === null || cents <= 0) return fail("Montant invalide.");
  const { user } = await getSession();
  const result = await insertInterest(user.id, parsed.data.accountId, cents, parsed.data.date);
  if (!result.ok) return fail(result.error);
  refresh();
  return ok(undefined);
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
