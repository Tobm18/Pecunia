import { NextResponse } from "next/server";
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
  const { supabase, user } = await getSession();
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
    const [recurrences, forecastItems, forecastDecisions, goals] = await Promise.all([
      supabase.from("recurrences").select("*"),
      supabase.from("forecast_items").select("*"),
      supabase.from("forecast_decisions").select("*"),
      supabase.from("goals").select("*"),
    ]);
    await supabase.from("profiles").update({ last_backup_at: new Date().toISOString() }).eq("id", user.id);
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
      recurrences: recurrences.data ?? [],
      forecastItems: forecastItems.data ?? [],
      forecastDecisions: forecastDecisions.data ?? [],
      goals: goals.data ?? [],
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
