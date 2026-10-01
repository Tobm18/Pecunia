import { clsx } from "clsx";
import { getAppData, getTransactions } from "@/lib/data/queries";
import { resolveMonth } from "@/lib/data/views";
import { addMonths, isInPeriod, lastMonths, monthAbbr, monthName, monthPeriod } from "@/lib/domain/dates";
import { categorySeries, compareMonths, savingsByAccount } from "@/lib/domain/analyses";
import { formatCents, formatPercent } from "@/lib/domain/money";
import { balanceSeriesFromCurrent, expensesByCategory, summarize, topPlaces } from "@/lib/domain/stats";
import { MonthSwitcher } from "@/components/app/filters";
import { BalanceArea, MonthlyBars } from "@/components/charts/charts";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { CategoryPicker } from "./category-picker";

export const metadata = { title: "Analyses" };

export default async function AnalysesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { profile, accounts, categories, balances } = await getAppData();
  const startDay = profile.monthStartDay;
  const { month, current } = resolveMonth(params.mois, startDay);
  const months = lastMonths(month, 12);
  const txs = await getTransactions({ from: monthPeriod(months[0]!, startDay).start });

  const period = monthPeriod(month, startDay);
  const prevPeriod = monthPeriod(addMonths(month, -1), startDay);
  const monthTxs = txs.filter((t) => isInPeriod(t.date, period));
  const prevTxs = txs.filter((t) => isInPeriod(t.date, prevPeriod));
  const yearTxs = txs.filter((t) => t.date <= period.end);

  const summary = summarize(monthTxs, accounts);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const comparison = compareMonths(monthTxs, prevTxs).slice(0, 8);
  const savings = savingsByAccount(yearTxs, accounts);
  const savingsMax = Math.max(1, ...savings.map((s) => Math.abs(s.totalCents)));
  const places = topPlaces(yearTxs, 5);

  const active = accounts.filter((a) => !a.archivedAt);
  const ends = months.map((m) => monthPeriod(m, startDay).end);
  const netWorthSeries = months.map((m, i) => ({
    label: monthAbbr(m),
    cents: active.reduce((sum, a) => {
      const balance = balances.get(a.id)?.balanceCents ?? a.initialBalanceCents;
      return sum + balanceSeriesFromCurrent(a.id, balance, txs, ends)[i]!;
    }, 0),
  }));
  const netWorth = netWorthSeries[netWorthSeries.length - 1]!.cents;

  // Catégorie suivie : celle de l'URL, sinon la plus grosse dépense du mois
  const expenseCategories = categories.filter((c) => !c.isIncome && !c.archivedAt);
  const topCategoryId = expensesByCategory(monthTxs).find((c) => c.categoryId)?.categoryId ?? expenseCategories[0]?.id ?? null;
  const categoryId = expenseCategories.some((c) => c.id === params.categorie) ? params.categorie! : topCategoryId;
  const series = categoryId
    ? categorySeries(txs, categoryId, months, startDay).map((m) => ({ label: monthAbbr(m.month), cents: m.cents }))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 pr-12 lg:pr-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-n-600">Analyses</p>
        <MonthSwitcher path="/analyses" month={month} current={current} params={{ categorie: params.categorie }} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold text-n-700">Taux d&apos;épargne</p>
          <p className="mt-1 text-3xl font-extrabold tabular-nums text-accent-700">
            {summary.savingsRate === null ? "-" : formatPercent(summary.savingsRate)}
          </p>
          <p className="text-[11px] text-n-600">
            {formatCents(summary.netCents, "always")} sur {formatCents(summary.incomeCents)} d&apos;entrées en {monthName(month)}
          </p>
        </Card>
        <Card className="lg:col-span-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold text-n-700">Patrimoine</p>
            <p className="text-2xl font-extrabold tabular-nums">{formatCents(netWorth)}</p>
          </div>
          <BalanceArea data={netWorthSeries} height={110} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Vs le mois dernier" />
          {comparison.length === 0 ? (
            <EmptyState>Aucune dépense ce mois-ci ni le mois précédent.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {comparison.map((c) => {
                const cat = c.categoryId ? categoryById.get(c.categoryId) : undefined;
                const up = c.currentCents > c.previousCents;
                return (
                  <li key={c.categoryId ?? "none"} className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: cat?.color ?? "#98a1b0" }} />
                    <span className="flex-1 truncate">{cat?.name ?? "Sans catégorie"}</span>
                    <span className="text-xs text-n-600 tabular-nums">
                      {formatCents(c.previousCents)} → {formatCents(c.currentCents)}
                    </span>
                    <span className={clsx("w-16 text-right text-xs font-bold tabular-nums", up ? "text-danger-700" : "text-accent-700")}>
                      {c.change === null ? "nouveau" : `${up ? "+" : ""}${formatPercent(c.change, 0)}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Épargne cumulée par compte · 12 mois" />
          {savings.length === 0 ? (
            <EmptyState>Aucun compte d&apos;épargne.</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {savings.map((s) => (
                <li key={s.account.id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="size-2 rounded-full" style={{ backgroundColor: s.account.color }} />
                      {s.account.name}
                    </span>
                    <span className="font-bold tabular-nums">{formatCents(s.totalCents, "always")}</span>
                  </div>
                  <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-n-200">
                    <div style={{ width: `${(Math.max(0, s.transfersCents) / savingsMax) * 100}%`, backgroundColor: s.account.color }} />
                    <div className="bg-accent" style={{ width: `${(Math.max(0, s.interestCents) / savingsMax) * 100}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-n-600">
                    Virements nets {formatCents(s.transfersCents, "always")} · intérêts {formatCents(s.interestCents)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Évolution d&apos;une catégorie · 12 mois</h2>
            <CategoryPicker categories={expenseCategories.map((c) => ({ id: c.id, name: c.name }))} value={categoryId} />
          </div>
          {series.length > 0 ? <MonthlyBars data={series} /> : <EmptyState>Aucune catégorie de dépense.</EmptyState>}
        </Card>
        <Card>
          <CardHeader title="Classement des lieux · 12 mois" />
          {places.length === 0 ? (
            <EmptyState>Aucune dépense.</EmptyState>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {places.map((p, i) => (
                <li key={p.place} className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-xs text-n-500">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.place}</p>
                    <p className="text-[11px] text-n-600">
                      {p.count} passage{p.count > 1 ? "s" : ""}
                    </p>
                    <div className="mt-1 h-1 rounded-full bg-accent-500" style={{ width: `${(p.cents / places[0]!.cents) * 100}%` }} />
                  </div>
                  <span className="font-semibold tabular-nums">{formatCents(p.cents)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
