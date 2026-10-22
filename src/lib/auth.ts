import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";

/**
 * Authentification (Better Auth) : email + mot de passe, sans envoi d'email.
 * Sessions en base (table session), cookie httpOnly posé par /api/auth/*.
 */
export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // URL propre à chaque déploiement Vercel (en plus du domaine de production)
  trustedOrigins: process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Usage personnel : l'inscription se ferme une fois le compte créé (NEXT_PUBLIC_ALLOW_SIGNUP=false).
    disableSignUp: process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "true",
    autoSignIn: true,
  },
  // doit rester le dernier plugin : pose les cookies depuis les server actions
  plugins: [nextCookies()],
});
