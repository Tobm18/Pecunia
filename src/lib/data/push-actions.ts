"use server";

import { and, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db, schema as s } from "@/lib/db";
import { isPushConfigured, sendPushToUser } from "@/lib/push";
import { getSession } from "./queries";

/** Notifications push : abonnement de l'appareil courant, désabonnement, notification de test. */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

const subscriptionInput = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

export async function subscribePush(input: z.input<typeof subscriptionInput>): Promise<ActionResult> {
  const parsed = subscriptionInput.safeParse(input);
  if (!parsed.success) return fail("Abonnement invalide.");
  if (!isPushConfigured()) return fail("Les notifications ne sont pas configurées sur le serveur.");
  const { user } = await getSession();
  const { endpoint, keys } = parsed.data;
  const userAgent = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  const p = s.pushSubscriptions;
  await db
    .insert(p)
    .values({ user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, user_agent: userAgent })
    .onConflictDoUpdate({ target: p.endpoint, set: { user_id: user.id, p256dh: keys.p256dh, auth: keys.auth, user_agent: userAgent } });
  return ok(undefined);
}

export async function unsubscribePush(endpoint: string): Promise<ActionResult> {
  const { user } = await getSession();
  await db.delete(s.pushSubscriptions).where(and(eq(s.pushSubscriptions.endpoint, endpoint), eq(s.pushSubscriptions.user_id, user.id)));
  return ok(undefined);
}

export async function sendTestPush(): Promise<ActionResult<{ sent: number }>> {
  const { user } = await getSession();
  const sent = await sendPushToUser(user.id, { title: "Pecunia", body: "Les notifications fonctionnent sur cet appareil.", url: "/parametres", tag: "test" });
  return sent ? ok({ sent }) : fail("Aucun appareil n'a reçu la notification. Désactive puis réactive les notifications.");
}
