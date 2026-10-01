import Link from "next/link";
import { getAppData, getBudgets } from "@/lib/data/queries";
import { getBudgetOverview, resolveMonth } from "@/lib/data/views";
import { budgetAccountIds } from "@/lib/domain/budgets";
import { formatCents, formatPercent } from "@/lib/domain/money";
import { shortAccountName } from "@/lib/domain/accounts";
import { MonthSwitcher } from "@/components/app/filters";
import { IconBadge } from "@/components/ui/icons";
import { Banner, Card, EmptyState, ProgressBar, statusText } from "@/components/ui/primitives";
import { BudgetEditButton, BudgetSettings } from "./budget-controls";

export const metadata = { title: "Budgets" };

export default async function BudgetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const { profile, accounts, categories } = await getAppData();
  const { month, current } = resolveMonth(params.mois, profile.monthStartDay);
  const [overview, budgets] = await Promise.all([getBudgetOverview(month), getBudgets()]);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const unbudgeted = categories.filter((c) => !c.archivedAt && !c.isIncome && !budgets.some((b) => b.categoryId === c.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 pr-12 lg:pr-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-n-600">Budgets</p>
        <MonthSwitcher path="/budgets" month={month} current={current} />
      </div>

      {overview.alerts.length > 0 && (
        <Banner tone="warn" action={<Link href="/" className="font-bold">Tableau de bord</Link>}>
          {overview.alerts.length} catégorie{overview.alerts.length > 1 ? "s" : ""} au-delà de 80 % du budget.
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <p className="text-sm font-semibold text-n-700">Reste à dépenser</p>
          <p className={`text-4xl font-extrabold tabular-nums ${overview.remainingCents < 0 ? "text-danger-700" : "text-accent-700"}`}>
            {formatCents(overview.remainingCents)}
          </p>
          <ProgressBar ratio={overview.ratio} status={overview.status} className="mt-3" />
          <p className="mt-1.5 text-xs text-n-600">
            {formatCents(overview.totalSpentCents)} sur {formatCents(overview.totalBudgetCents)} · {formatPercent(overview.ratio, 0)} -
            dépenses réelles uniquement
          </p>
        </Card>
        <Card>
          <BudgetSettings
            carryOver={profile.budgetCarryOver}
            carryOverCents={overview.carryOverCents}
            referenceIncomeCents={profile.referenceIncomeCents}
          />
        </Card>
      </div>

      <Card className="!p-0">
        {overview.lines.length === 0 ? (
          <div className="p-4">
            <EmptyState>Aucun budget défini. Choisis une catégorie ci-dessous pour en créer un.</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-divider">
            {overview.lines.map((l) => {
              const accountNames = [...budgetAccountIds(l.category, accounts)]
                .map((id) => accountById.get(id))
                .filter((a) => a && !a.archivedAt)
                .map((a) => shortAccountName(a!));
              return (
                <li key={l.category.id}>
                  <BudgetEditButton
                    categoryId={l.category.id}
                    categoryName={l.category.name}
                    mode={l.budget.mode}
                    amountCents={l.budget.mode === "percent" ? Math.round((l.budget.percent ?? 0) * 100) : l.budget.amountCents}
                    referenceIncomeCents={profile.referenceIncomeCents}
                  >
                    <div className="flex items-center gap-3">
                      <IconBadge icon={l.category.icon} color={l.category.color} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold">{l.category.name}</p>
                          <p className={`text-sm font-bold ${statusText[l.status]}`}>{formatPercent(Math.min(l.ratio, 9.99), 0)}</p>
                        </div>
                        <p className="text-[11px] text-n-600">
                          {accountNames.join(" + ")}
                          {l.budget.mode === "percent" && ` · ${String(l.budget.percent).replace(".", ",")} % du revenu`}
                        </p>
                        <ProgressBar ratio={l.ratio} status={l.status} className="mt-2" />
                        <div className="mt-1 flex justify-between text-[11px]">
                          <span className={l.remainingCents < 0 ? "font-bold text-danger-700" : "text-n-600"}>
                            {l.remainingCents < 0 ? `Dépassé de ${formatCents(-l.remainingCents)}` : `Reste ${formatCents(l.remainingCents)}`}
                          </span>
                          <span className="text-n-600 tabular-nums">
                            {formatCents(l.spentCents)} / {formatCents(l.budgetCents)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </BudgetEditButton>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {unbudgeted.length > 0 && (
        <Card>
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-n-700">Catégories sans budget</h2>
          <ul className="flex flex-wrap gap-2">
            {unbudgeted.map((c) => (
              <li key={c.id}>
                <BudgetEditButton
                  categoryId={c.id}
                  categoryName={c.name}
                  mode="fixed"
                  amountCents={null}
                  referenceIncomeCents={profile.referenceIncomeCents}
                  compact
                >
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name} <span className="text-accent-700">+</span>
                  </span>
                </BudgetEditButton>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
