import "server-only";
import { betterAuth } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";

/**
 * Authentification (Better Auth) : email + mot de passe, sans envoi d'email.
 * Sessions en base (table session), cookie httpOnly posé par /api/auth/*.
 */
const appUrl = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000");

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  // URL propre à chaque déploiement Vercel (en plus du domaine de production)
  trustedOrigins: process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : [],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      apikey: schema.apikey,
      passkey: schema.passkey,
    },
  }),
  advanced: { database: { generateId: "uuid" } },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Usage personnel : l'inscription se ferme une fois le compte créé (NEXT_PUBLIC_ALLOW_SIGNUP=false).
    disableSignUp: process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "true",
    autoSignIn: true,
  },
  plugins: [
    // Clés d'API pour une autre application (G Koi À Faire) : une clé n'ouvre que ses permissions,
    // vérifiées route par route (src/app/api/integrations) ; elle ne crée jamais de session.
    apiKey({
      defaultPrefix: "pec_",
      rateLimit: { enabled: false },
      permissions: { defaultPermissions: { wishes: ["sync"] } },
    }),
    // Passkeys (Face ID, Touch ID…) : liées au domaine de l'app ; une URL de prévisualisation
    // Vercel ne peut donc pas s'en servir.
    passkey({
      rpID: appUrl.hostname,
      rpName: "Pecunia",
      origin: appUrl.origin,
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    }),
    // doit rester le dernier plugin : pose les cookies depuis les server actions
    nextCookies(),
  ],
});
