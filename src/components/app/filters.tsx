import Link from "next/link";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, monthLabel, type MonthKey } from "@/lib/domain/dates";
import type { Account } from "@/lib/domain/types";
import { Chip } from "@/components/ui/primitives";
import { withParams } from "@/lib/data/views";
import { shortAccountName } from "@/lib/domain/accounts";

const arrow =
  "flex size-11 items-center justify-center rounded-xl border border-n-300 bg-surface hover:bg-n-100 md:size-8 md:rounded-lg";

/** ‹ Septembre 2026 › — bloqué au-delà du mois courant. */
export function MonthSwitcher({
  path,
  month,
  current,
  params = {},
}: {
  path: string;
  month: MonthKey;
  current: MonthKey;
  params?: Record<string, string | null | undefined>;
}) {
  const next = addMonths(month, 1);
  const canGoNext = next <= current;
  return (
    <div className="flex items-center gap-3">
      <Link href={withParams(path, { ...params, mois: addMonths(month, -1) })} className={arrow} aria-label="Mois précédent">
        <ChevronLeft size={18} />
      </Link>
      <h1 className="min-w-44 flex-1 text-center text-xl font-extrabold md:flex-none md:text-left md:text-3xl">
        {monthLabel(month)}
      </h1>
      {canGoNext ? (
        <Link
          href={withParams(path, { ...params, mois: next === current ? null : next })}
          className={arrow}
          aria-label="Mois suivant"
        >
          <ChevronRight size={18} />
        </Link>
      ) : (
        <span className={clsx(arrow, "cursor-not-allowed opacity-40")} aria-disabled="true" aria-label="Mois suivant">
          <ChevronRight size={18} />
        </span>
      )}
    </div>
  );
}

/** Puces « Tous » + un compte actif par puce, en liens (filtre dans l'URL). */
export function AccountChips({
  path,
  accounts,
  selected,
  params = {},
  allLabel = "Tous",
}: {
  path: string;
  accounts: Account[];
  selected: string | null;
  params?: Record<string, string | null | undefined>;
  allLabel?: string;
}) {
  return (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      <Chip active={!selected} href={withParams(path, { ...params, compte: null })}>
        {allLabel}
      </Chip>
      {accounts.map((a) => (
        <Chip key={a.id} active={selected === a.id} color={a.color} href={withParams(path, { ...params, compte: a.id })}>
          {shortAccountName(a)}
        </Chip>
      ))}
    </div>
  );
}
