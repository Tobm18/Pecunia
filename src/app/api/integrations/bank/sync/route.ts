import { syncAllConnections } from "@/lib/data/bank";
import { sendDueReminders } from "@/lib/data/reminders";
import { todayIso } from "@/lib/domain/dates";

/**
 * Tâche quotidienne, déclenchée par le cron Vercel (vercel.json) : synchronisation bancaire, puis
 * rappels en notification push (intérêts d'épargne le 31 décembre).
 * Vercel envoie « Authorization: Bearer <CRON_SECRET> » ; sans ce secret configuré, la route reste fermée.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Non autorisé." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  // une banque en panne n'empêche pas les rappels, et inversement
  const [sync, reminders] = await Promise.all([
    syncAllConnections().catch(() => ({ error: "synchronisation échouée" })),
    sendDueReminders(todayIso()).catch(() => ({ error: "rappels échoués" })),
  ]);
  return Response.json({ sync, reminders }, { headers: { "Cache-Control": "no-store" } });
}
