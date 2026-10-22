import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { completeAuthorization } from "@/lib/data/bank";

/**
 * Retour de la banque après le consentement : ?code=…&state=… (ou ?error=…).
 * Contrairement aux autres routes d'intégration, celle-ci est appelée par le navigateur de
 * l'utilisateur : elle exige sa session, et le « state » doit correspondre à une connexion en
 * attente créée par lui (connectBank).
 */
export async function GET(request: NextRequest) {
  const back = (query: string) => NextResponse.redirect(new URL(`/parametres/banque?${query}`, request.nextUrl.origin));

  const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
  if (!session) return NextResponse.redirect(new URL("/login", request.nextUrl.origin));

  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  if (params.get("error") || !state || !code) {
    return back(`erreur=${encodeURIComponent(params.get("error_description") ?? "Autorisation refusée ou interrompue.")}`);
  }

  const result = await completeAuthorization(session.user.id, state, code);
  return result.ok ? back("connecte=1") : back(`erreur=${encodeURIComponent(result.error)}`);
}
