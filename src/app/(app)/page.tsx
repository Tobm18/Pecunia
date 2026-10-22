import Link from "next/link";
import { ArrowLeftRight, Banknote, PiggyBank, ShoppingCart, TrendingUp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { getAppData, getForecastDecisions, getTransactions } from "@/lib/data/queries";
import { getBudgetOverview, resolveMonth } from "@/lib/data/views";
import { addMonths, isInPeriod, lastMonths, monthAbbr, monthKeyOf, monthPeriod, shortDate, todayIso } from "@/lib/domain/dates";
import { recurrenceKey } from "@/lib/domain/forecast";
import { buildOccurrences, signedRecurrenceCents } from "@/lib/domain/recurrences";
import { shortAccountName } from "@/lib/domain/accounts";
import { formatCents, formatPercent } from "@/lib/domain/money";
import { formatList } from "@/lib/domain/text";
import {
  balanceSeriesFromCurrent,
  expensesByCategory,
  filterByAccount,
  monthlyExpenses,
  summarize,
  topPlaces,
} from "@/lib/domain/stats";
import { ACCOUNT_TYPE_LABELS } from "@/lib/domain/defaults";
import { AccountChips, MonthSwitcher } from "@/components/app/filters";
import { DonutChart, MonthlyBars } from "@/components/charts/charts";
import { Sparkline } from "@/components/charts/sparkline";
import { IconBadge } from "@/components/ui/icons";
import { Amount } from "@/components/ui/money";
import { Banner, Card, CardHeader, EmptyState, ProgressBar, buttonClass, statusText } from "@/components/ui/primitives";

export const metadata = { title: "Tableau de bord" };

function Kpi({ icon, label, value, sub, accent }: { icon: ReactNode; label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <Card className="!p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-n-700">
        <span className="flex size-6 items-center justify-center rounded-md bg-n-100 text-n-700">{icon}</span>
        {label}
      </p>
      <p className={`mt-2 text-2xl font-extrabold tabular-nums ${accent ? "text-accent-700" : ""}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-n-600">{sub}</p>
    </Card>
  );
}

const cardLink = "text-xs font-bold text-accent-700 hover:text-accent";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { profile, accounts, categories, balances, recurrences, forecastItems } = await getAppData();
  const startDay = profile.monthStartDay;
  const { month, current } = resolveMonth(params.mois, startDay);
  const activeAccounts = accounts.filter((a) => !a.archivedAt);
  const accountId = activeAccounts.some((a) => a.id === params.compte) ? params.compte! : null;

  const months = lastMonths(month, 12);
  const period = monthPeriod(month, startDay);
  const windowStart = monthPeriod(months[0]!, startDay).start;
  // Depuis le début de la fenêtre de 12 mois jusqu'à aujourd'hui (sparklines reconstruites à rebours)
  const txs = await getTransactions({ from: windowStart });
  const monthTxs = txs.filter((t) => isInPeriod(t.date, period));
  const scoped = filterByAccount(monthTxs, accountId);

  const summary = summarize(monthTxs, accounts, accountId);
  const budgets = await getBudgetOverview(month, monthTxs);
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const breakdown = expensesByCategory(scoped);
  const places = topPlaces(scoped);
  const bars = monthlyExpenses(filterByAccount(txs, accountId), months, startDay).map((m) => ({
    label: monthAbbr(m.month),
    cents: m.cents,
  }));

  const monthEnds = months.map((m) => monthPeriod(m, startDay).end);
  const accountRows = activeAccounts.map((a) => {
    const balance = balances.get(a.id)?.balanceCents ?? a.initialBalanceCents;
    return { account: a, balance, series: balanceSeriesFromCurrent(a.id, balance, txs, monthEnds) };
  });
  const netWorth = accountRows.reduce((s, r) => s + r.balance, 0);
  const netWorthYearAgo = accountRows.reduce(
    (s, r) => s + balanceSeriesFromCurrent(r.account.id, r.balance, txs, [monthPeriod(addMonths(month, -12), startDay).end])[0]!,
    0,
  );
  const inBudgetNames = activeAccounts.filter((a) => a.inBudget).map((a) => a.name);

  // À venir : 5 prochaines échéances (récurrences non réalisées + dépenses prévues)
  const today = todayIso();
  const horizonEnd = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  // décisions du prévisionnel : échéances refusées masquées, montants et dates modifiés repris
  const decisionByKey = new Map((await getForecastDecisions(monthKeyOf(today, startDay))).map((d) => [d.sourceKey, d]));
  const upcoming = [
    ...buildOccurrences(recurrences, txs, today, horizonEnd)
      .filter((o) => o.status === "planned" && decisionByKey.get(recurrenceKey(o.recurrence.id, o.date))?.status !== "rejected")
      .filter((o) => !accountId || o.recurrence.accountId === accountId || o.recurrence.toAccountId === accountId)
      .map((o) => {
        const d = decisionByKey.get(recurrenceKey(o.recurrence.id, o.date));
        const r = d?.amountCents ? { ...o.recurrence, amountCents: d.amountCents } : o.recurrence;
        const incoming = r.type === "transfer" && accountId !== null && r.toAccountId === accountId;
        return {
          key: o.key,
          date: d?.date ?? o.date,
          label: r.label,
          cents: r.type === "transfer" ? (incoming ? r.amountCents : -r.amountCents) : signedRecurrenceCents(r),
          transfer: r.type === "transfer",
          color: r.type === "transfer" ? "#98a1b0" : (categoryById.get(r.categoryId ?? "")?.color ?? "#98a1b0"),
          meta: [r.categoryId ? categoryById.get(r.categoryId)?.name : "Virement", accountById.get(r.accountId) && shortAccountName(accountById.get(r.accountId)!)]
            .filter(Boolean)
            .join(" · "),
        };
      }),
    ...forecastItems
      .filter(
        (f) =>
          f.status === "planned" && f.date >= today && f.date <= horizonEnd && (!accountId || f.accountId === accountId || f.toAccountId === accountId),
      )
      .map((f) => {
        const from = accountById.get(f.accountId);
        const to = f.toAccountId ? accountById.get(f.toAccountId) : undefined;
        return {
          key: f.id,
          date: f.date,
          label: f.label,
          // virement vu depuis le compte filtré : crédit si c'est le compte de destination
          cents: f.toAccountId && accountId === f.toAccountId ? -f.amountCents : f.amountCents,
          transfer: !!f.toAccountId,
          color: f.toAccountId ? "#98a1b0" : "#e9a23b",
          meta: f.toAccountId
            ? ["Virement prévu", from && to && `${shortAccountName(from)} → ${shortAccountName(to)}`].filter(Boolean).join(" · ")
            : ["Prévue", from && shortAccountName(from)].filter(Boolean).join(" · "),
        };
      }),
  ]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, 5);

  const overs = budgets.alerts.filter((l) => l.status === "over").map((l) => l.category.name);
  const warns = budgets.alerts.filter((l) => l.status === "warn");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <p className="hidden text-[11px] font-bold uppercase tracking-wider text-n-600 md:block">Tableau de bord</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonthSwitcher path="/" month={month} current={current} params={{ compte: accountId }} />
          <div className="flex min-w-0 items-center gap-3">
            <AccountChips path="/" accounts={activeAccounts} selected={accountId} params={{ mois: params.mois }} />
            <Link href="/saisie" className={buttonClass("primary", "max-md:hidden")}>
              + Nouvelle saisie
            </Link>
          </div>
        </div>
      </div>

      {budgets.alerts.length > 0 && (
        <div className="hidden md:block">
          <Banner tone="warn" action={<Link href="/budgets" className="font-bold">Voir les budgets</Link>}>
            <span className="inline-flex items-center gap-2">
              <TriangleAlert size={15} />
              {overs.length > 0 && `${formatList(overs)} au-dessus du budget. `}
              {warns.length > 0 &&
                `${formatList(warns.map((w) => `${w.category.name} à ${formatPercent(w.ratio, 0)}`))} - seuil de 80 % franchi.`}
            </span>
          </Banner>
        </div>
      )}

      {/* KPI : carte unique sur mobile, 4 cartes sur ordinateur */}
      <Card className="md:hidden">
        <p className="text-sm font-semibold text-n-700">Solde du mois</p>
        <p className={`text-4xl font-extrabold tabular-nums ${summary.netCents >= 0 ? "text-accent-700" : ""}`}>
          {formatCents(summary.netCents, "always")}
        </p>
        <div className="mt-3 grid grid-cols-3 border-t border-divider pt-3 text-sm">
          <div>
            <p className="text-xs text-n-600">Entrées</p>
            <p className="font-bold tabular-nums">{formatCents(summary.incomeCents).replace(/,\d\d/, "")}</p>
          </div>
          <div>
            <p className="text-xs text-n-600">Sorties</p>
            <p className="font-bold tabular-nums">{formatCents(summary.expenseCents).replace(/,\d\d/, "")}</p>
          </div>
          <div>
            <p className="text-xs text-n-600">Épargné</p>
            <p className="font-bold text-accent-700 tabular-nums">{formatCents(summary.savedCents).replace(/,\d\d/, "")}</p>
          </div>
        </div>
      </Card>
      <div className="hidden grid-cols-4 gap-4 md:grid">
        <Kpi
          icon={<Banknote size={14} />}
          label="Entrées"
          value={formatCents(summary.incomeCents)}
          sub={summary.interestCents ? `dont ${formatCents(summary.interestCents)} d'intérêts` : "Revenus du mois"}
        />
        <Kpi icon={<ShoppingCart size={14} />} label="Sorties" value={formatCents(summary.expenseCents)} sub="Hors virements internes" />
        <Kpi
          icon={<TrendingUp size={14} />}
          label="Solde du mois"
          value={formatCents(summary.netCents, "always")}
          sub={summary.savingsRate === null ? "Aucune entrée ce mois-ci" : `Taux d'épargne ${formatPercent(summary.savingsRate)}`}
          accent={summary.netCents >= 0}
        />
        <Kpi icon={<PiggyBank size={14} />} label="Épargné ce mois-ci" value={formatCents(summary.savedCents)} sub="Virements vers l'épargne + intérêts" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Mes comptes" action={<Link href="/comptes" className={cardLink}>Gérer</Link>} />
          <p className="mb-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums">{formatCents(netWorth)}</span>
            <span className="text-xs font-bold text-accent-700">
              {formatCents(netWorth - netWorthYearAgo, "always").replace(/,\d\d/, "")} en 12 mois
            </span>
          </p>
          <ul className="divide-y divide-divider">
            {accountRows.map(({ account, balance, series }) => (
              <li key={account.id}>
                <Link href={`/comptes/${account.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <IconBadge icon={account.icon} color={account.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{account.name}</p>
                    <p className="text-xs text-n-600">
                      {ACCOUNT_TYPE_LABELS[account.type]}
                      {account.inBudget && account.type !== "savings" ? " · dans le budget" : ""}
                    </p>
                  </div>
                  <Sparkline values={series} color={account.color} className="hidden sm:block" />
                  <span className="min-w-24 text-right font-bold tabular-nums">{formatCents(balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col">
          <CardHeader title="Budget global" action={<Link href="/budgets" className={cardLink}>Budgets</Link>} />
          {budgets.lines.length === 0 ? (
            <EmptyState action={<Link href="/budgets" className={cardLink}>Définir un budget</Link>}>Aucun budget défini</EmptyState>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span className={`text-2xl font-extrabold tabular-nums ${budgets.remainingCents < 0 ? "text-danger-700" : "text-accent-700"}`}>
                  {formatCents(budgets.remainingCents)}
                </span>
                <span className="text-xs text-n-600">reste à dépenser</span>
              </p>
              <ProgressBar ratio={budgets.ratio} status={budgets.status} className="mt-3" />
              <div className="mt-1.5 flex justify-between text-[11px] text-n-600">
                <span>
                  {formatCents(budgets.totalSpentCents)} sur {formatCents(budgets.totalBudgetCents)} · {formatPercent(budgets.ratio, 0)}
                </span>
                <span>Seuil d&apos;alerte 80 %</span>
              </div>
              <p className="mt-auto flex items-start gap-2 rounded-lg bg-n-100 px-3 py-2 pt-2 text-[11px] text-n-700">
                <ArrowLeftRight size={13} className="mt-0.5 shrink-0" />
                Calculé sur {inBudgetNames.join(" + ") || "aucun compte"}. Les virements
                {summary.savingsTransfersCents > 0 && accountId === null
                  ? ` (${formatCents(summary.savingsTransfersCents)} vers l'épargne ce mois-ci)`
                  : ""}{" "}
                sont exclus.
              </p>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Répartition des dépenses" />
          {breakdown.length === 0 ? (
            <EmptyState>Aucune dépense sur ce compte - les virements ne comptent pas</EmptyState>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              <DonutChart
                totalCents={summary.expenseCents}
                data={breakdown.map((b) => {
                  const c = b.categoryId ? categoryById.get(b.categoryId) : undefined;
                  return { name: c?.name ?? "Sans catégorie", cents: b.cents, color: c?.color ?? "#98a1b0" };
                })}
              />
              <ul className="w-full flex-1 text-sm">
                {breakdown.map((b) => {
                  const c = b.categoryId ? categoryById.get(b.categoryId) : undefined;
                  return (
                    <li key={b.categoryId ?? "none"} className="flex items-center gap-2 py-1">
                      <span className="size-2 rounded-full" style={{ backgroundColor: c?.color ?? "#98a1b0" }} />
                      <span className="flex-1 truncate">{c?.name ?? "Sans catégorie"}</span>
                      <span className="tabular-nums">{formatCents(b.cents)}</span>
                      <span className="w-10 text-right text-xs text-n-600 tabular-nums">{Math.round(b.share * 100)} %</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Dépenses mensuelles" />
          <MonthlyBars data={bars} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="À venir" action={<Link href="/prevision" className={cardLink}>Prévisionnel</Link>} />
          {upcoming.length === 0 ? (
            <EmptyState action={<Link href="/recurrences" className={cardLink}>Ajouter une récurrence</Link>}>
              {accountId ? "Rien de prévu sur ce compte" : "Rien de prévu dans les 60 prochains jours"}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {upcoming.map((u) => (
                <li key={u.key} className="flex items-center gap-3 text-sm">
                  <span className="w-12 shrink-0 text-xs text-n-600">{shortDate(u.date)}</span>
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: u.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{u.label}</p>
                    <p className="truncate text-[11px] text-n-600">{u.meta}</p>
                  </div>
                  <Amount cents={u.cents} neutral={u.transfer && !accountId} className="text-xs" />
                </li>
              ))}
            </ul>
          )}
        </Card>
        {budgets.alerts.length > 0 && (
          <Card>
            <CardHeader title="Alertes" action={<Link href="/budgets" className={cardLink}>Budgets</Link>} />
            <ul className="flex flex-col gap-3">
              {budgets.alerts.map((l) => (
                <li key={l.category.id}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full" style={{ backgroundColor: l.category.color }} />
                      {l.category.name}
                    </span>
                    <span className={`font-bold ${statusText[l.status]}`}>{formatPercent(l.ratio, 0)}</span>
                  </div>
                  <ProgressBar ratio={l.ratio} status={l.status} className="mt-1.5" />
                  <p className="mt-1 text-[11px] text-n-600">
                    {formatCents(l.spentCents)} / {formatCents(l.budgetCents)} ·{" "}
                    {l.remainingCents < 0 ? `Dépassé de ${formatCents(-l.remainingCents)}` : `Reste ${formatCents(l.remainingCents)}`}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {places.length > 0 && (
          <Card>
            <CardHeader title="Top lieux" action={<Link href="/analyses" className={cardLink}>Analyses</Link>} />
            <ol className="flex flex-col gap-2.5">
              {places.map((p, i) => (
                <li key={p.place} className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-xs text-n-600">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.place}</p>
                    <div className="mt-1 h-1 rounded-full bg-accent-500" style={{ width: `${(p.cents / places[0]!.cents) * 100}%` }} />
                  </div>
                  <Amount cents={p.cents} className="!font-semibold !text-text" />
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}
