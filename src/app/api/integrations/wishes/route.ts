import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema as s } from "@/lib/db";
import { runAsUser, type SessionUser } from "@/lib/data/queries";
import { syncWishes, wishReport } from "@/lib/data/wishes";

/**
 * Intégration G Koi À Faire (clé d'API, permission « wishes:sync ») :
 *   PUT /api/integrations/wishes  { wishes: [...] }  remplace la liste des souhaits, renvoie le rapport
 *   GET /api/integrations/wishes                      rapport seul (marge du mois, état des souhaits)
 * En-tête : « x-api-key: pec_… » (ou « Authorization: Bearer pec_… »).
 */

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Utilisateur de la clé, si elle est valide et porte la permission ; sinon null. */
async function keyOwner(request: Request): Promise<SessionUser | null> {
  const header = request.headers.get("x-api-key") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!header) return null;
  const result = await auth.api.verifyApiKey({ body: { key: header, permissions: { wishes: ["sync"] } } });
  if (!result.valid || !result.key) return null;
  const [owner] = await db
    .select({ id: s.user.id, email: s.user.email, name: s.user.name })
    .from(s.user)
    .where(eq(s.user.id, result.key.referenceId));
  return owner ?? null;
}

export async function GET(request: Request) {
  const owner = await keyOwner(request);
  if (!owner) return json({ error: "Clé d'API invalide." }, 401);
  return runAsUser(owner, async () => json(await wishReport()));
}

export async function PUT(request: Request) {
  const owner = await keyOwner(request);
  if (!owner) return json({ error: "Clé d'API invalide." }, 401);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "JSON invalide." }, 400);
  }
  return runAsUser(owner, async () => {
    const saved = await syncWishes(body as never);
    if (!saved.ok) return json({ error: saved.error }, 400);
    return json(await wishReport());
  });
}
