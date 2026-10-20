"use client";

import { useState } from "react";
import { useAppData } from "@/components/app/app-data";
import { Amount } from "@/components/ui/money";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { deleteTransaction } from "@/lib/data/actions";
import { EditTransactionModal } from "@/components/transactions/edit-transaction-modal";
import { dayLabel } from "@/lib/domain/dates";
import type { Transaction } from "@/lib/domain/types";

export function AccountTransactions({ groups }: { groups: { date: string; total: number; items: Transaction[] }[] }) {
  const { categoryById, accountById } = useAppData();
  const [editing, setEditing] = useState<Transaction | null>(null);
  const all = groups.flatMap((g) => g.items);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <section key={g.date} className="overflow-hidden rounded-card bg-surface shadow-card">
          <header className="flex items-center justify-between border-b border-divider px-4 py-2.5 text-sm">
            <h3 className="font-bold">{dayLabel(g.date)}</h3>
            <Amount cents={g.total} className="!text-xs !font-normal !text-n-600" />
          </header>
          <ul className="divide-y divide-divider">
            {g.items.map((t) => (
              <li key={t.id}>
                <SwipeActions
                  label={`Supprimer ${t.place || "la transaction"}`}
                  successMessage={t.type === "transfer" ? "Virement supprimé" : "Transaction supprimée"}
                  onDelete={() => deleteTransaction(t.id)}
                >
                  <TransactionRow
                    tx={t}
                    consolidated={false}
                    showAccount={t.type === "transfer"}
                    category={t.categoryId ? categoryById.get(t.categoryId) : undefined}
                    account={accountById.get(t.accountId)}
                    counterpart={t.counterpartAccountId ? accountById.get(t.counterpartAccountId) : undefined}
                    onClick={() => setEditing(t)}
                  />
                </SwipeActions>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <EditTransactionModal tx={editing} transactions={all} onClose={() => setEditing(null)} />
    </div>
  );
}
