import "server-only";
import { Resend } from "resend";

/**
 * Envoi des emails d'authentification (lien magique, réinitialisation) via Resend.
 * Sans RESEND_API_KEY (développement), le lien est écrit dans la console du serveur.
 */
export async function sendMail({ to, subject, text }: { to: string; subject: string; text: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[mail] RESEND_API_KEY absent, email non envoyé à ${to} :\n${subject}\n${text}`);
    return;
  }
  const { error } = await new Resend(key).emails.send({
    from: process.env.MAIL_FROM || "Pecunia <onboarding@resend.dev>",
    to,
    subject,
    text,
  });
  if (error) console.error(`[mail] échec de l'envoi à ${to} :`, error.message);
}
