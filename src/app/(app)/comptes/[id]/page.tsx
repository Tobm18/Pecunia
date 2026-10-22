import Link from "next/link";
import { notFound } from "next/navigation";
import { getAppData, getGoals, getTransactions } from "@/lib/data/queries";
import { goalStatus } from "@/lib/domain/goals";
import { todayIso } from "@/lib/domain/dates";
import { resolveMonth } from "@/lib/data/views";
import { isInPeriod, lastMonths, monthAbbr, monthName, monthPeriod, numericDate } from "@/lib/domain/dates";
import { ACCOUNT_TYPE_LABELS } from "@/lib/domain/defaults";
import { formatCents } from "@/lib/domain/money";
import { balanceSeriesFromCurrent, groupByDay, signedTotal, summarize } from "@/lib/domain/stats";
import { shortAccountName } from "@/lib/domain/accounts";
import { BalanceArea } from "@/components/charts/charts";
import { IconBadge } from "@/components/ui/icons";
import { BackLink, Card, Chip, EmptyState } from "@/components/ui/primitives";
import { AccountSettings, AdjustBalanceButton } from "@/components/accounts/account-dialogs";
import { GoalCard } from "@/components/accounts/goals-section";
import { AccountTransactions } from "./account-transactions";

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ profile, accounts, balances, recurrences }, goals] = await Promise.all([getAppData(), getGoals()]);
  const account = accounts.find((a) => a.id === id);
  if (!account) notFound();

  const startDay = profile.monthStartDay;
  const { current } = resolveMonth(undefined, startDay);
  const months = lastMonths(current, 12);
  const period = monthPeriod(current, startDay);
  const txs = await getTransactions({ accountId: id, from: monthPeriod(months[0]!, startDay).start });
  const balance = balances.get(id)?.balanceCents ?? account.initialBalanceCents;
  const series = balanceSeriesFromCurrent(id, balance, txs, months.map((m) => monthPeriod(m, startDay).end));
  const monthTxs = txs.filter((t) => isInPeriod(t.date, period));
  const summary = summarize(monthTxs, accounts, id);
  const transfersNet = monthTxs.filter((t) => t.type === "transfer").reduce((s, t) => s + t.amountCents, 0);
  const active = accounts.filter((a) => !a.archivedAt);

  const stats = [
    { label: "Entrées", value: summary.incomeCents, cls: "text-accent-700" },
    { label: "Sorties", value: summary.expenseCents, cls: "" },
    { label: "Virements nets", value: transfersNet, cls: "", signed: true },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <BackLink href="/comptes">Comptes</BackLink>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <IconBadge icon={account.icon} color={account.color} size="lg" />
            <div>
              <h1 className="text-3xl font-extrabold md:text-4xl">{account.name}</h1>
              <p className="text-xs text-n-600">
                {ACCOUNT_TYPE_LABELS[account.type]} · {account.inBudget ? "dans le budget" : "hors budget"} · solde initial{" "}
                {formatCents(account.initialBalanceCents)} au {numericDate(account.initialBalanceDate)}
                {account.archivedAt && " · archivé"}
              </p>
            </div>
          </div>
          <div className="no-scrollbar hidden gap-2 overflow-x-auto md:flex">
            {active.map((a) => (
              <Chip key={a.id} active={a.id === id} href={`/comptes/${a.id}`}>
                {shortAccountName(a)}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-n-700">Solde actuel</p>
              <p className="text-4xl font-extrabold tabular-nums">{formatCents(balance)}</p>
            </div>
            <AdjustBalanceButton account={account} balanceCents={balance} />
          </div>
          <div className="mt-3">
            <BalanceArea data={months.map((m, i) => ({ label: monthAbbr(m), cents: series[i]! }))} color={account.color} />
          </div>
          <div className="mt-3 grid grid-cols-3 border-t border-divider pt-3 lg:hidden">
            {stats.map((s) => (
              <div key={s.label}>
                <p className="text-xs text-n-600">{s.label}</p>
                <p className={`font-bold tabular-nums ${s.cls}`}>{formatCents(s.value, s.signed ? "always" : "auto")}</p>
              </div>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-4">
          <Card className="hidden lg:block">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-n-700">{monthName(current)}</h2>
            <dl className="flex flex-col gap-1.5 text-sm">
              {stats.map((s) => (
                <div key={s.label} className="flex justify-between">
                  <dt className="text-n-700">{s.label}</dt>
                  <dd className={`font-bold tabular-nums ${s.cls}`}>{formatCents(s.value, s.signed ? "always" : "auto")}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {goals
            .filter((g) => g.accountId === account.id)
            .map((g) => (
              <GoalCard key={g.id} status={goalStatus(g, balance, recurrences, todayIso())} />
            ))}
          {!account.archivedAt && (
            <Card>
              <AccountSettings account={account} balanceCents={balance} />
            </Card>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-lg font-extrabold">Transactions du compte</h2>
        <div className="flex items-center gap-3">
          <span className="whitespace-nowrap text-xs text-n-600">{monthTxs.length} ce mois-ci</span>
          {!account.archivedAt && (
            <Link href={`/import?compte=${account.id}`} className="text-xs font-bold text-accent-700 hover:text-accent">
              Importer un CSV
            </Link>
          )}
        </div>
      </div>
      {txs.length === 0 ? (
        <EmptyState>Aucune transaction sur les 12 derniers mois.</EmptyState>
      ) : (
        <AccountTransactions
          groups={groupByDay(txs.slice(0, 100)).map((g) => ({ ...g, total: signedTotal(g.items, id) }))}
        />
      )}
    </div>
  );
}
