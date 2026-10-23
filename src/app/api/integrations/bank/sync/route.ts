import { syncAllConnections } from "@/lib/data/bank";
import { autoCategorizeAll } from "@/lib/data/categorize";
import { sendDueReminders } from "@/lib/data/reminders";
import { todayIso } from "@/lib/domain/dates";

// synchronisation, recherches dans l'annuaire des entreprises et rappels : jusqu'à 5 minutes
export const maxDuration = 300;

/**
 * Tâche quotidienne, déclenchée par le cron Vercel (vercel.json) : synchronisation bancaire, puis
 * classement automatique des transactions, et rappels en notification push (intérêts d'épargne
 * le 31 décembre). Vercel envoie « Authorization: Bearer <CRON_SECRET> » ; sans ce secret
 * configuré, la route reste fermée.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Non autorisé." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  // une banque en panne n'empêche ni le classement ni les rappels, et inversement
  const [sync, reminders] = await Promise.all([
    syncAllConnections().catch(() => ({ error: "synchronisation échouée" })),
    sendDueReminders(todayIso()).catch(() => ({ error: "rappels échoués" })),
  ]);
  const categorize = await autoCategorizeAll().catch(() => ({ error: "classement échoué" }));
  return Response.json({ sync, categorize, reminders }, { headers: { "Cache-Control": "no-store" } });
}
