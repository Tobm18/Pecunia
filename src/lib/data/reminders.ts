import "server-only";
import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { interestReminder } from "@/lib/domain/bank-sync";
import { formatList } from "@/lib/domain/text";
import { sendPushToUser } from "@/lib/push";

/**
 * Rappels envoyés en notification push par la tâche quotidienne (cron). Aujourd'hui : les intérêts
 * d'épargne, le 31 décembre, pour chaque utilisateur dont un compte épargne n'a pas encore ses
 * intérêts de l'année (le bandeau du tableau de bord prend ensuite le relais jusqu'au 31 janvier).
 */
export async function sendDueReminders(today: string): Promise<{ notified: number }> {
  if (!today.endsWith("-12-31")) return { notified: 0 };
  const subscribers = await db.selectDistinct({ userId: s.pushSubscriptions.user_id }).from(s.pushSubscriptions);
  let notified = 0;
  for (const { userId } of subscribers) {
    const savings = await db
      .select({ id: s.accounts.id, name: s.accounts.name })
      .from(s.accounts)
      .where(and(eq(s.accounts.user_id, userId), eq(s.accounts.type, "savings"), isNull(s.accounts.archived_at)));
    if (!savings.length) continue;
    const interests = await db
      .select({ accountId: s.transactions.account_id, date: s.transactions.date })
      .from(s.transactions)
      .where(
        and(
          eq(s.transactions.user_id, userId),
          eq(s.transactions.type, "interest"),
          inArray(
            s.transactions.account_id,
            savings.map((a) => a.id),
          ),
          gte(s.transactions.date, `${today.slice(0, 4)}-12-01`),
        ),
      );
    const due = interestReminder(today, savings, interests);
    if (!due) continue;
    const sent = await sendPushToUser(userId, {
      title: "Intérêts de tes comptes épargne",
      body: `N'oublie pas de saisir les intérêts ${due.year} : ${formatList(due.accounts.map((a) => a.name))}.`,
      url: "/parametres/banque#interets",
      tag: `interets-${due.year}`,
    });
    if (sent) notified++;
  }
  return { notified };
}
