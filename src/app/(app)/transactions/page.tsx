import Link from "next/link";
import { after } from "next/server";
import { autoCategorize, countUnprocessed } from "@/lib/data/categorize";
import { getAppData, getSession, getTransactions } from "@/lib/data/queries";
import { resolveMonth } from "@/lib/data/views";
import { isValidIsoDate, longDayMonth, monthPeriod, todayIso } from "@/lib/domain/dates";
import { MonthSwitcher } from "@/components/app/filters";
import { buttonClass } from "@/components/ui/primitives";
import { PeriodPicker, type PeriodMode } from "./period-picker";
import { TransactionsView } from "./transactions-view";

// le classement automatique (recherches dans l'annuaire des entreprises) tourne après la réponse
export const maxDuration = 60;

export const metadata = { title: "Transactions" };

const shiftMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const { profile, accounts } = await getAppData();
  const mode: PeriodMode = (["3m", "12m", "tout", "dates"] as const).find((m) => m === params.periode) ?? "mois";
  const { month, current } = resolveMonth(params.mois, profile.monthStartDay);
  const today = todayIso();

  // Période demandée : un mois (par défaut), les 3 ou 12 derniers mois, tout, ou des dates choisies
  let range: { from?: string; to?: string };
  if (mode === "3m") range = { from: shiftMonths(today, -3) };
  else if (mode === "12m") range = { from: shiftMonths(today, -12) };
  else if (mode === "tout") range = {};
  else if (mode === "dates") range = { from: isValidIsoDate(params.du) ? params.du : undefined, to: isValidIsoDate(params.au) ? params.au : undefined };
  else range = { from: monthPeriod(month, profile.monthStartDay).start, to: monthPeriod(month, profile.monthStartDay).end };

  const [txs, { user }] = await Promise.all([getTransactions(range), getSession()]);
  // lignes pas encore classées automatiquement (nouvelles, ou d'avant ce classement) : il tourne après l'affichage
  if ((await countUnprocessed(user.id)) > 0) after(() => autoCategorize(user.id).catch(() => undefined));
  const initialAccount = accounts.some((a) => a.id === params.compte) ? params.compte! : null;
  const rangeLabel =
    mode === "dates"
      ? [range.from ? `du ${longDayMonth(range.from)} ${range.from.slice(0, 4)}` : null, range.to ? `au ${longDayMonth(range.to)} ${range.to.slice(0, 4)}` : null]
          .filter(Boolean)
          .join(" ") || "Toutes les dates"
      : mode === "tout"
        ? "Tout l'historique"
        : mode === "mois"
          ? null
          : `${mode === "3m" ? "3" : "12"} derniers mois`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-n-600">Historique</p>
          <h1 className="text-3xl font-extrabold md:text-4xl">Transactions</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/categories/classer" className={buttonClass("secondary")}>
            À vérifier
          </Link>
          <Link href={initialAccount ? `/import?compte=${initialAccount}` : "/import"} className={buttonClass("secondary")}>
            Importer un CSV
          </Link>
          <Link href="/saisie" className={buttonClass("primary", "max-md:hidden")}>
            + Nouvelle saisie
          </Link>
        </div>
      </div>
      <PeriodPicker mode={mode} from={range.from ?? null} to={range.to ?? null} account={initialAccount} />
      {mode === "mois" ? (
        <MonthSwitcher path="/transactions" month={month} current={current} params={{ compte: initialAccount }} />
      ) : (
        <h2 className="text-xl font-extrabold md:text-2xl">{rangeLabel}</h2>
      )}
      <TransactionsView key={`${mode}-${month}-${range.from}-${range.to}`} transactions={txs} initialAccount={initialAccount} />
    </div>
  );
}
