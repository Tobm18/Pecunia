import Link from "next/link";
import { clsx } from "clsx";
import { TriangleAlert } from "lucide-react";
import { getAppData, getTransactions } from "@/lib/data/queries";
import { getBudgetOverview, withParams } from "@/lib/data/views";
import { addMonths, monthAbbr, monthKeyOf, monthLabel, monthName, monthPeriod, shortDate, todayIso } from "@/lib/domain/dates";
import { projectBalances } from "@/lib/domain/forecast";
import { buildOccurrences, occurrenceWindow } from "@/lib/domain/recurrences";
import { formatCents } from "@/lib/domain/money";
import { AccountChips } from "@/components/app/filters";
import { ForecastChart } from "@/components/charts/charts";
import { Amount } from "@/components/ui/money";
import { Banner, Card, EmptyState } from "@/components/ui/primitives";
import { PlannedItems } from "./planned-items";

export const metadata = { title: "Prévisionnel" };

const HORIZONS = [1, 3, 6, 12] as const;

export default async function ForecastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { profile, accounts, balances, recurrences, forecastItems } = await getAppData();
  const today = todayIso();
  const startDay = profile.monthStartDay;
  const horizon = HORIZONS.find((h) => String(h) === params.horizon) ?? 3;
  const active = accounts.filter((a) => !a.archivedAt);
  const accountId = active.some((a) => a.id === params.compte) ? params.compte! : null;

  const current = monthKeyOf(today, startDay);
  const from = monthPeriod(current, startDay).start;
  const to = monthPeriod(addMonths(current, horizon - 1), startDay).end;
  const range = occurrenceWindow(from, to);
  const [txs, budgets] = await Promise.all([getTransactions({ from: range.from, to: range.to }), getBudgetOverview(current)]);
  const occurrences = buildOccurrences(recurrences, txs, from, to);
  const { months, alerts } = projectBalances({
    accounts,
    balances: Object.fromEntries([...balances].map(([id, b]) => [id, b.balanceCents])),
    today,
    horizon,
    startDay,
    occurrences,
    forecastItems,
    budgets,
  });

  const shown = accountId ? active.filter((a) => a.id === accountId) : active;
  const visibleAlerts = alerts.filter((a) => !accountId || a.accountId === accountId);
  const accountName = new Map(active.map((a) => [a.id, a.name]));
  const chartData = [
    { label: "Auj.", ...Object.fromEntries(shown.map((a) => [a.id, balances.get(a.id)?.balanceCents ?? a.initialBalanceCents])) },
    ...months.map((m) => ({ label: monthAbbr(m.month), ...Object.fromEntries(shown.map((a) => [a.id, m.perAccount[a.id]!.endBalanceCents])) })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 pr-12 lg:pr-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-n-600">Anticipation</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-extrabold md:text-4xl">Prévisionnel</h1>
          <div role="radiogroup" aria-label="Horizon" className="inline-flex gap-0.5 rounded-[10px] bg-n-200 p-[3px]">
            {HORIZONS.map((h) => (
              <Link
                key={h}
                role="radio"
                aria-checked={h === horizon}
                href={withParams("/prevision", { horizon: h === 3 ? null : String(h), compte: accountId })}
                className={clsx(
                  "flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold md:min-h-8",
                  h === horizon ? "bg-surface text-text shadow-card" : "text-n-700 hover:text-text",
                )}
              >
                {h} mois
              </Link>
            ))}
          </div>
        </div>
        <AccountChips path="/prevision" accounts={active} selected={accountId} params={{ horizon: params.horizon }} allLabel="Tous comptes" />
      </div>

      {visibleAlerts.map((a) => (
        <Banner key={a.accountId} tone="danger">
          <span className="inline-flex items-center gap-2">
            <TriangleAlert size={15} />
            <span>
              <strong>{accountName.get(a.accountId)}</strong> en négatif en {monthName(a.month)} · {formatCents(a.balanceCents)} projetés.
              Prévois un virement.
            </span>
          </span>
        </Banner>
      ))}

      <Card>
        <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-n-700">Solde projeté en fin de mois</h2>
        <ForecastChart data={chartData} series={shown.map((a) => ({ key: a.id, name: a.name, color: a.color }))} />
        <p className="mt-2 text-[11px] text-n-600">
          Solde actuel + échéances des récurrences non réalisées + dépenses prévues − dépenses courantes estimées d&apos;après tes budgets
          (hors catégories déjà couvertes par une récurrence).
        </p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {months.map((m) => {
          const items = shown.flatMap((a) => m.perAccount[a.id]!.items.map((i) => ({ ...i, accountId: a.id })));
          const end = shown.reduce((s, a) => s + m.perAccount[a.id]!.endBalanceCents, 0);
          const negative = shown.some((a) => m.perAccount[a.id]!.endBalanceCents < 0);
          return (
            <Card key={m.month} className={clsx("border-l-4", negative ? "border-l-danger" : "border-l-accent")}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-bold">{monthLabel(m.month)}</h3>
                <span className={clsx("text-lg font-extrabold tabular-nums", end < 0 && "text-danger-700")}>{formatCents(end)}</span>
              </div>
              <p className="mb-2 text-[11px] text-n-600">Solde de fin de mois projeté{shown.length > 1 ? " (tous comptes)" : ""}</p>
              {items.length === 0 ? (
                <EmptyState>Rien de prévu.</EmptyState>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {items.map((i, idx) => (
                    <li key={idx} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {i.label}
                        <span className="text-[11px] text-n-600">
                          {i.date && ` · ${shortDate(i.date)}`}
                          {shown.length > 1 && ` · ${accountName.get(i.accountId)}`}
                          {i.kind === "planned" && " · prévue"}
                          {i.kind === "estimate" && " · estimation"}
                        </span>
                      </span>
                      <Amount cents={i.amountCents} className="text-xs" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      <PlannedItems
        items={forecastItems.filter((f) => f.status === "planned" && f.date >= today)}
        defaultAccountId={accountId}
      />
    </div>
  );
}
