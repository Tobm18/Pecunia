import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { auth } from "@/lib/auth";

/** Pages accessibles sans session */
const PUBLIC_PATHS = ["/login", "/inscription", "/mot-de-passe-oublie", "/auth", "/api/auth"];

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico)$).*)"],
};
