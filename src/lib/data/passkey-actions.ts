"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import type { ActionResult } from "./integration-actions";

/**
 * Passkeys de l'utilisateur connecté : liste et suppression. L'ajout se fait dans le navigateur
 * (authClient.passkey.addPasskey), seul à pouvoir demander Face ID / Touch ID.
 */

const PASSKEY_NAME_MAX = 40;

export interface PasskeyInfo {
  id: string;
  name: string | null;
  createdAt: string | null;
  /** Synchronisée entre appareils (trousseau iCloud, gestionnaire de mots de passe) */
  backedUp: boolean;
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
  const passkeys = await auth.api.listPasskeys({ headers: await headers() });
  return passkeys.map((p) => ({
    id: p.id,
    name: p.name ?? null,
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    backedUp: p.backedUp,
  }));
}

export async function renamePasskey(id: string, name: string): Promise<ActionResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Donne un nom à la passkey." };
  if (clean.length > PASSKEY_NAME_MAX) return { ok: false, error: `${PASSKEY_NAME_MAX} caractères au plus.` };
  try {
    await auth.api.updatePasskey({ body: { id, name: clean }, headers: await headers() });
    revalidatePath("/parametres", "layout");
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Renommage impossible, réessaie dans un instant." };
  }
}

export async function deletePasskey(id: string): Promise<ActionResult> {
  try {
    await auth.api.deletePasskey({ body: { id }, headers: await headers() });
    revalidatePath("/parametres", "layout");
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Suppression impossible, réessaie dans un instant." };
  }
}
