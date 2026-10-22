import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { db, schema } from "@/lib/db";
import { sendMail } from "@/lib/mail";

/**
 * Authentification (Better Auth) : email + mot de passe, lien magique, réinitialisation.
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
    resetPasswordTokenExpiresIn: 30 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await sendMail({
        to: user.email,
        subject: "Pecunia - réinitialisation du mot de passe",
        text: `Pour choisir un nouveau mot de passe, ouvre ce lien (valable 30 minutes) :\n\n${url}\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email.`,
      });
    },
  },
  plugins: [
    magicLink({
      // pas de création de compte par lien magique (comme avant : shouldCreateUser: false)
      disableSignUp: true,
      expiresIn: 15 * 60,
      sendMagicLink: async ({ email, url }) => {
        await sendMail({
          to: email,
          subject: "Pecunia - ton lien de connexion",
          text: `Pour te connecter, ouvre ce lien (valable 15 minutes, utilisable une seule fois) :\n\n${url}\n\nSi tu n'es pas à l'origine de cette demande, ignore cet email.`,
        });
      },
    }),
    // doit rester le dernier plugin : pose les cookies depuis les server actions
    nextCookies(),
  ],
});
