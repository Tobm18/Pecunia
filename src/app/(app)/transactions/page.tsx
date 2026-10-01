import Link from "next/link";
import { getAppData, getTransactions } from "@/lib/data/queries";
import { resolveMonth } from "@/lib/data/views";
import { monthPeriod } from "@/lib/domain/dates";
import { MonthSwitcher } from "@/components/app/filters";
import { buttonClass } from "@/components/ui/primitives";
import { TransactionsView } from "./transactions-view";

export const metadata = { title: "Transactions" };

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { profile, accounts } = await getAppData();
  const { month, current } = resolveMonth(params.mois, profile.monthStartDay);
  const period = monthPeriod(month, profile.monthStartDay);
  const txs = await getTransactions({ from: period.start, to: period.end });
  const initialAccount = accounts.some((a) => a.id === params.compte) ? params.compte! : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 pr-12 lg:pr-0">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-n-600">Historique</p>
          <h1 className="text-3xl font-extrabold md:text-4xl">Transactions</h1>
        </div>
        <div className="flex gap-2">
          <Link href={initialAccount ? `/import?compte=${initialAccount}` : "/import"} className={buttonClass("secondary")}>
            Importer un CSV
          </Link>
          <Link href="/saisie" className={buttonClass("primary", "max-md:hidden")}>
            + Nouvelle saisie
          </Link>
        </div>
      </div>
      <MonthSwitcher path="/transactions" month={month} current={current} params={{ compte: initialAccount }} />
      <TransactionsView key={month} transactions={txs} initialAccount={initialAccount} />
    </div>
  );
}
