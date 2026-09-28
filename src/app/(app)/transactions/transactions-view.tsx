"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useAppData } from "@/components/app/app-data";
import { Chip, EmptyState, Segmented, Select } from "@/components/ui/primitives";
import { Amount } from "@/components/ui/money";
import { dayLabel } from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import { shortAccountName } from "@/lib/domain/accounts";
import { groupByDay, signedTotal } from "@/lib/domain/stats";
import type { Transaction } from "@/lib/domain/types";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { EditTransactionModal } from "@/components/transactions/edit-transaction-modal";

type TypeFilter = "all" | "out" | "in" | "transfer";

export function TransactionsView({ transactions, initialAccount }: { transactions: Transaction[]; initialAccount: string | null }) {
  const { activeAccounts, activeCategories, categoryById, accountById } = useAppData();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string | null>(initialAccount);
  const [type, setType] = useState<TypeFilter>("all");
  const [categoryId, setCategoryId] = useState<string>("");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("fr-FR");
    return transactions.filter((t) => {
      // En vue « tous comptes », un virement n'apparaît qu'une fois (ligne source)
      if (accountId ? t.accountId !== accountId : t.type === "transfer" && t.amountCents > 0) return false;
      if (type === "out" && t.type !== "out") return false;
      if (type === "in" && t.type !== "in" && t.type !== "interest") return false;
      if (type === "transfer" && t.type !== "transfer") return false;
      if (categoryId && t.categoryId !== categoryId) return false;
      if (q && !`${t.place ?? ""} ${t.note ?? ""}`.toLocaleLowerCase("fr-FR").includes(q)) return false;
      return true;
    });
  }, [transactions, search, accountId, type, categoryId]);

  const total = signedTotal(filtered, accountId);
  const groups = groupByDay(filtered);

  return (
    <>
      <div className="flex flex-col gap-3 md:rounded-card md:bg-surface md:p-4 md:shadow-card">
        <div className="grid gap-3 md:grid-cols-[1fr_200px]">
          <label className="relative block">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-n-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un lieu, une note"
              className="block min-h-11 w-full rounded-[10px] border border-n-300 bg-surface pr-3 pl-9 text-[15px] placeholder:text-n-500 focus:border-accent focus:outline-none md:min-h-9 md:text-sm"
            />
          </label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie" className="hidden md:block">
            <option value="">Toutes les catégories</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <Segmented
          value={type}
          onChange={setType}
          className="w-full md:w-auto md:self-start"
          options={[
            { value: "all", label: "Tout" },
            { value: "out", label: "Sorties" },
            { value: "in", label: "Entrées" },
            { value: "transfer", label: "Virements" },
          ]}
        />
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Chip active={!accountId} onClick={() => setAccountId(null)}>
            Tous comptes
          </Chip>
          {activeAccounts.map((a) => (
            <Chip key={a.id} active={accountId === a.id} color={a.color} onClick={() => setAccountId(a.id)}>
              {shortAccountName(a)}
            </Chip>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between rounded-card bg-accent-100 px-4 py-3.5">
        <p className="text-sm text-n-800">
          <strong>{filtered.length}</strong> transaction{filtered.length > 1 ? "s" : ""}
          {!accountId && <span className="hidden md:inline"> · virements internes neutres dans le total</span>}
        </p>
        <p className={`text-xl font-extrabold tabular-nums md:text-2xl ${total >= 0 ? "text-accent-700" : ""}`}>
          {formatCents(total, total > 0 ? "always" : "auto")}
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState>Aucune transaction ne correspond à ces filtres.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const dayTotal = signedTotal(g.items, accountId);
            return (
              <section key={g.date} className="overflow-hidden rounded-card bg-surface shadow-card">
                <header className="flex items-center justify-between border-b border-divider px-4 py-2.5 text-sm">
                  <h2 className="font-bold">{dayLabel(g.date)}</h2>
                  <Amount cents={dayTotal} className="!text-xs !font-normal !text-n-600" />
                </header>
                <ul className="divide-y divide-divider">
                  {g.items.map((t) => (
                    <li key={t.id}>
                      <TransactionRow
                        tx={t}
                        consolidated={!accountId}
                        category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
                        account={accountById.get(t.accountId)}
                        counterpart={t.counterpartAccountId ? accountById.get(t.counterpartAccountId) : undefined}
                        onClick={() => setEditing(t)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <EditTransactionModal tx={editing} transactions={transactions} onClose={() => setEditing(null)} />
    </>
  );
}
