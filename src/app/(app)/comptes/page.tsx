import Link from "next/link";
import { getAppData, getGoals, getTransactions } from "@/lib/data/queries";
import { resolveMonth } from "@/lib/data/views";
import { addMonths, lastMonths, monthAbbr, monthPeriod, todayIso } from "@/lib/domain/dates";
import { goalStatus } from "@/lib/domain/goals";
import { ACCOUNT_TYPE_LABELS } from "@/lib/domain/defaults";
import { formatCents } from "@/lib/domain/money";
import { balanceSeriesFromCurrent } from "@/lib/domain/stats";
import { BalanceArea } from "@/components/charts/charts";
import { Sparkline } from "@/components/charts/sparkline";
import { IconBadge } from "@/components/ui/icons";
import { Card, PageHeader } from "@/components/ui/primitives";
import { NewAccountButton, RestoreAccountButton } from "@/components/accounts/account-dialogs";
import { GoalsSection } from "@/components/accounts/goals-section";

export const metadata = { title: "Comptes" };

export default async function AccountsPage() {
  const [{ profile, accounts, balances, recurrences }, goals] = await Promise.all([getAppData(), getGoals()]);
  const startDay = profile.monthStartDay;
  const { current } = resolveMonth(undefined, startDay);
  const months = lastMonths(current, 12);
  const ends = months.map((m) => monthPeriod(m, startDay).end);
  const yearAgoEnd = monthPeriod(addMonths(current, -12), startDay).end;
  const txs = await getTransactions({ from: monthPeriod(months[0]!, startDay).start });

  const active = accounts.filter((a) => !a.archivedAt);
  const archived = accounts.filter((a) => a.archivedAt);
  const rows = active.map((a) => {
    const balance = balances.get(a.id)?.balanceCents ?? a.initialBalanceCents;
    const [yearAgo] = balanceSeriesFromCurrent(a.id, balance, txs, [yearAgoEnd]);
    return { account: a, balance, delta: balance - yearAgo!, series: balanceSeriesFromCurrent(a.id, balance, txs, ends) };
  });
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const totalDelta = rows.reduce((s, r) => s + r.delta, 0);
  const totalSeries = months.map((m, i) => ({ label: monthAbbr(m), cents: rows.reduce((s, r) => s + r.series[i]!, 0) }));
  const positive = rows.filter((r) => r.balance > 0);
  const positiveTotal = positive.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <PageHeader kicker="Patrimoine" title="Comptes" actions={<NewAccountButton />} />
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_minmax(0,1fr)] md:items-end">
          <div>
            <p className="text-sm font-semibold text-n-700">Patrimoine total</p>
            <p className="text-4xl font-extrabold tabular-nums">{formatCents(total)}</p>
            <p className="mt-1 text-sm font-bold text-accent-700">{formatCents(totalDelta, "always").replace(/,\d\d/, "")} en 12 mois</p>
            {positiveTotal > 0 && (
              <>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full">
                  {positive.map((r) => (
                    <div key={r.account.id} style={{ width: `${(r.balance / positiveTotal) * 100}%`, backgroundColor: r.account.color }} />
                  ))}
                </div>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-n-700">
                  {positive.map((r) => (
                    <span key={r.account.id} className="flex items-center gap-1">
                      <span className="size-1.5 rounded-full" style={{ backgroundColor: r.account.color }} />
                      {r.account.name} {Math.round((r.balance / positiveTotal) * 100)} %
                    </span>
                  ))}
                </p>
              </>
            )}
          </div>
          <BalanceArea data={totalSeries} height={150} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(({ account, balance, delta, series }) => (
          <Link key={account.id} href={`/comptes/${account.id}`} className="rounded-card bg-surface p-4 shadow-card transition-shadow hover:shadow-pop">
            <div className="flex items-center gap-2.5">
              <IconBadge icon={account.icon} color={account.color} />
              <div className="min-w-0">
                <p className="truncate font-bold">{account.name}</p>
                <p className="text-xs text-n-600">{ACCOUNT_TYPE_LABELS[account.type]}</p>
              </div>
            </div>
            <p className="mt-3 text-2xl font-extrabold tabular-nums">{formatCents(balance)}</p>
            <Sparkline values={series} color={account.color} width={220} height={40} className="mt-2 w-full" />
            <div className="mt-2 flex items-center justify-between text-[11px] text-n-600">
              <span>{formatCents(delta, "always").replace(/,\d\d/, "")} sur 12 mois</span>
              <span className={`rounded-full px-2 py-0.5 font-bold ${account.inBudget ? "bg-accent-100 text-accent-700" : "bg-n-200 text-n-700"}`}>
                {account.inBudget ? "Dans le budget" : "Hors budget"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      <GoalsSection
        statuses={goals.map((g) =>
          goalStatus(g, balances.get(g.accountId)?.balanceCents ?? accounts.find((a) => a.id === g.accountId)?.initialBalanceCents ?? 0, recurrences, todayIso()),
        )}
      />

      {archived.length > 0 && (
        <Card>
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-n-600">Archivés - historique conservé</h2>
          <ul className="divide-y divide-divider">
            {archived.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2 opacity-70">
                <IconBadge icon={a.icon} color="#98a1b0" size="sm" />
                <Link href={`/comptes/${a.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{a.name}</p>
                  <p className="text-[11px] text-n-600">
                    Archivé en {new Date(a.archivedAt!).toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} ·{" "}
                    {balances.get(a.id)?.count ?? 0} transactions conservées
                  </p>
                </Link>
                <RestoreAccountButton id={a.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
