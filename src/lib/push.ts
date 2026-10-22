import "server-only";
import { eq, inArray } from "drizzle-orm";
import webpush from "web-push";
import { db, schema as s } from "@/lib/db";

/**
 * Envoi de notifications push (Web Push, clés VAPID). La clé publique est aussi lue par le
 * navigateur (NEXT_PUBLIC_VAPID_PUBLIC_KEY) ; la clé privée ne quitte jamais le serveur.
 * Un abonnement que le service de push déclare disparu (404 / 410) est supprimé.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Page ouverte au toucher de la notification */
  url?: string;
  /** Une notification de même tag remplace la précédente */
  tag?: string;
}

export const isPushConfigured = () => !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;

let configured = false;
function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    // contact demandé par les services de push (Apple, Google, Mozilla) : mailto: ou https:
    process.env.VAPID_SUBJECT?.trim() || process.env.BETTER_AUTH_URL || "https://pecunia.tballester.fr",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  configured = true;
}

/** Envoie à tous les appareils de l'utilisateur ; renvoie le nombre d'envois réussis. */
export async function sendPushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!isPushConfigured()) return 0;
  configure();
  const subs = await db.select().from(s.pushSubscriptions).where(eq(s.pushSubscriptions.user_id, userId));
  const gone: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(message), { TTL: 24 * 3600 });
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) gone.push(sub.id);
      }
    }),
  );
  if (gone.length) await db.delete(s.pushSubscriptions).where(inArray(s.pushSubscriptions.id, gone));
  return sent;
}
