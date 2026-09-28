"use client";

import { useState } from "react";
import { QuickEntryForm } from "@/components/entry/quick-entry-form";
import { useAppData } from "@/components/app/app-data";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatCents } from "@/lib/domain/money";
import { shortDate } from "@/lib/domain/dates";

interface SessionEntry {
  key: number;
  label: string;
  amount: string;
  accountName: string;
  categoryName: string | null;
  date: string;
}

/** Écran Saisie web : formulaire rapide + « Cette session » + soldes à jour. */
export function EntrySession() {
  const { activeAccounts, balances } = useAppData();
  const [entries, setEntries] = useState<SessionEntry[]>([]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      <Card>
        <QuickEntryForm
          variant="page"
          onCreated={(e) =>
            setEntries((list) => [
              { key: Date.now(), label: e.label, amount: e.amount, accountName: e.accountName, categoryName: e.categoryName, date: e.date },
              ...list,
            ])
          }
        />
      </Card>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Cette session" action={<span className="text-xs text-n-600">{entries.length} saisie{entries.length > 1 ? "s" : ""}</span>} />
          {entries.length === 0 ? (
            <p className="text-sm text-n-600">Les mouvements validés apparaîtront ici.</p>
          ) : (
            <ul className="divide-y divide-divider">
              {entries.map((e) => (
                <li key={e.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-bold">{e.label}</p>
                    <p className="text-[11px] text-n-600">
                      {[shortDate(e.date), e.categoryName, e.accountName].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="tabular-nums">{e.amount}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Soldes à jour" />
          <ul className="flex flex-col gap-2 text-sm">
            {activeAccounts.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ backgroundColor: a.color }} />
                  {a.name}
                </span>
                <span className="font-bold tabular-nums">{formatCents(balances[a.id] ?? 0)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <p className="px-1 text-[11px] text-n-600">
          Raccourcis : <strong>Entrée</strong> valide · <strong>Tab</strong> champ suivant · catégorie et compte repris du dernier
          passage au même endroit.
        </p>
      </div>
    </div>
  );
}
