"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Clés d'API des applications reliées (G Koi À Faire) : création, liste, révocation.
 * Une clé n'a que la permission « wishes:sync » (voir src/lib/auth.ts) ; seul son hash est stocké,
 * la clé en clair n'est montrée qu'une fois, à la création.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface IntegrationKey {
  id: string;
  name: string | null;
  /** Premiers caractères, pour reconnaître la clé */
  start: string | null;
  createdAt: string;
  lastRequest: string | null;
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function listIntegrationKeys(): Promise<IntegrationKey[]> {
  const { apiKeys } = await auth.api.listApiKeys({ headers: await headers() });
  return apiKeys.map((k) => ({ id: k.id, name: k.name ?? null, start: k.start ?? null, createdAt: iso(k.createdAt)!, lastRequest: iso(k.lastRequest) }));
}

export async function createIntegrationKey(name: string): Promise<ActionResult<{ key: string }>> {
  const clean = name.trim().slice(0, 60) || "G Koi À Faire";
  try {
    const created = await auth.api.createApiKey({ body: { name: clean }, headers: await headers() });
    revalidatePath("/parametres", "layout");
    return { ok: true, data: { key: created.key } };
  } catch {
    return { ok: false, error: "Création de la clé impossible, réessaie dans un instant." };
  }
}

export async function revokeIntegrationKey(keyId: string): Promise<ActionResult> {
  try {
    await auth.api.deleteApiKey({ body: { keyId }, headers: await headers() });
    revalidatePath("/parametres", "layout");
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, error: "Révocation impossible, réessaie dans un instant." };
  }
}
