import { syncAllConnections } from "@/lib/data/bank";

/**
 * Synchronisation quotidienne, déclenchée par le cron Vercel (vercel.json).
 * Vercel envoie « Authorization: Bearer <CRON_SECRET> » ; sans ce secret configuré, la route reste fermée.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Non autorisé." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const report = await syncAllConnections();
  return Response.json(report, { headers: { "Cache-Control": "no-store" } });
}
