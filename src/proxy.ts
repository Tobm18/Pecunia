import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/auth";

/**
 * Pages accessibles sans session. /api/integrations : autres applications reliées, authentifiées
 * par clé d'API (vérifiée, avec ses permissions, dans chaque route), jamais par cookie.
 */
const PUBLIC_PATHS = ["/login", "/inscription", "/api/auth", "/api/integrations"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  // Vérification optimiste (présence du cookie) : la session est validée en base par
  // getSession() dans chaque page et chaque action.
  const hasCookie = !!getSessionCookie(request);

  if (!hasCookie && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (hasCookie && (path === "/login" || path === "/inscription")) {
    // ici on vérifie vraiment : un cookie expiré ne doit pas renvoyer vers l'app (boucle)
    const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    if (session) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  // fichiers de la PWA (icônes, manifeste, service worker, écran hors connexion) : servis sans session
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|offline.html|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
