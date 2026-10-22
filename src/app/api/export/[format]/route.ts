import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { getAccounts, getBudgets, getCategories, getProfile, getSession, getTransactions } from "@/lib/data/queries";
import { centsToCsv, toCsv } from "@/lib/domain/csv";
import { todayIso } from "@/lib/domain/dates";

const TYPE_LABELS: Record<string, string> = {
  out: "Sortie",
  in: "Entrée",
  transfer: "Virement",
  interest: "Intérêts",
  adjust: "Régularisation",
};

/** Export complet : /api/export/csv (transactions) ou /api/export/json (sauvegarde intégrale). */
export async function GET(_request: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  const { user } = await getSession();
  const [profile, accounts, categories, budgets, transactions] = await Promise.all([
    getProfile(),
    getAccounts(),
    getCategories(),
    getBudgets(),
    getTransactions(),
  ]);
  const stamp = todayIso();

  if (format === "csv") {
    const accountName = new Map(accounts.map((a) => [a.id, a.name]));
    const categoryName = new Map(categories.map((c) => [c.id, c.name]));
    const body = toCsv(
      ["Date", "Type", "Lieu / libellé", "Catégorie", "Compte", "Compte lié", "Montant", "Note"],
      [...transactions]
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .map((t) => [
          t.date,
          TYPE_LABELS[t.type],
          t.place,
          t.categoryId ? categoryName.get(t.categoryId) : "",
          accountName.get(t.accountId),
          t.counterpartAccountId ? accountName.get(t.counterpartAccountId) : "",
          centsToCsv(t.amountCents),
          t.note,
        ]),
    );
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pecunia-transactions-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "json") {
    // lignes brutes (colonnes SQL), comme dans les sauvegardes précédentes
    const [recurrences, forecastItems, forecastDecisions, goals] = await Promise.all([
      db.select().from(s.recurrences).where(eq(s.recurrences.user_id, user.id)),
      db.select().from(s.forecastItems).where(eq(s.forecastItems.user_id, user.id)),
      db.select().from(s.forecastDecisions).where(eq(s.forecastDecisions.user_id, user.id)),
      db.select().from(s.goals).where(eq(s.goals.user_id, user.id)),
    ]);
    await db.update(s.profiles).set({ last_backup_at: new Date() }).where(eq(s.profiles.id, user.id));
    const backup = {
      app: "pecunia",
      version: 1,
      exportedAt: new Date().toISOString(),
      amountsIn: "cents",
      profile,
      accounts,
      categories,
      budgets,
      transactions,
      recurrences,
      forecastItems,
      forecastDecisions,
      goals,
    };
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="pecunia-sauvegarde-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ error: "Format inconnu" }, { status: 404 });
}
