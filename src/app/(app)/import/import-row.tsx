"use client";

import { clsx } from "clsx";
import { Trash2 } from "lucide-react";
import { memo } from "react";
import { DRAFT_TYPE_LABELS, isTransferType, type DraftRow, type DraftType } from "@/lib/domain/csv-import";
import { numericDate } from "@/lib/domain/dates";
import { sanitizeAmountInput } from "@/lib/domain/money";
import type { ExistingLine } from "@/lib/domain/csv-import";
import type { Account, Category } from "@/lib/domain/types";

const cell = "h-9 w-full rounded-lg border border-transparent bg-transparent px-2 text-sm hover:border-n-300 focus:border-accent focus:bg-surface focus:outline-none";

export interface RowActions {
  update: (key: string, patch: Partial<DraftRow>) => void;
  setCategory: (key: string, categoryId: string | null) => void;
  remove: (key: string) => void;
}

/** Une ligne du tableau d'import, éditable sur place. */
export const ImportRowView = memo(function ImportRowView({
  row,
  problem,
  link,
  linkAccountName,
  typeOptions,
  categories,
  otherAccounts,
  actions,
}: {
  row: DraftRow;
  problem: string | null;
  /** Ligne existante de l'autre compte qui deviendra l'autre moitié du virement */
  link: ExistingLine | null;
  linkAccountName: string;
  typeOptions: DraftType[];
  categories: Category[];
  otherAccounts: Account[];
  actions: RowActions;
}) {
  const outflow = row.type === "out" || row.type === "transfer_out";
  const visibleCategories = categories.filter((c) => (row.type === "out" ? !c.isIncome : true));
  return (
    <tr
      className={clsx(
        "border-b border-divider align-middle",
        !row.include && "opacity-45",
        row.include && problem && "bg-danger-100/50",
      )}
    >
      <td className="px-2">
        <input
          type="checkbox"
          checked={row.include}
          onChange={(e) => actions.update(row.key, { include: e.target.checked })}
          aria-label="Importer cette ligne"
        />
      </td>
      <td className="w-36">
        <input type="date" value={row.date} onChange={(e) => actions.update(row.key, { date: e.target.value })} className={cell} aria-label="Date" />
      </td>
      <td className="w-36">
        <select
          value={row.type}
          onChange={(e) => {
            const type = e.target.value as DraftType;
            actions.update(row.key, { type, categoryId: isTransferType(type) || type === "interest" ? null : row.categoryId });
          }}
          className={cell}
          aria-label="Type"
        >
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {DRAFT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </td>
      <td className="min-w-48">
        <input value={row.label} onChange={(e) => actions.update(row.key, { label: e.target.value })} className={cell} aria-label="Libellé" placeholder="Libellé" />
      </td>
      <td className="w-44">
        {isTransferType(row.type) ? (
          <select
            value={row.counterpartId ?? ""}
            onChange={(e) => actions.update(row.key, { counterpartId: e.target.value || null })}
            className={cell}
            aria-label="Autre compte"
          >
            <option value="">Compte…</option>
            {otherAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        ) : row.type === "interest" ? (
          <span className="px-2 text-xs text-n-600">Revenu d&apos;épargne</span>
        ) : (
          <select
            value={row.categoryId ?? ""}
            onChange={(e) => actions.setCategory(row.key, e.target.value || null)}
            className={cell}
            aria-label="Catégorie"
          >
            <option value="">Catégorie…</option>
            {visibleCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </td>
      <td className="w-32">
        <div className="flex items-center">
          <span className={clsx("w-3 text-sm font-bold", outflow ? "text-n-600" : "text-accent-700")}>{outflow ? "−" : "+"}</span>
          <input
            inputMode="decimal"
            value={row.amount}
            onChange={(e) => actions.update(row.key, { amount: sanitizeAmountInput(e.target.value) })}
            className={clsx(cell, "text-right tabular-nums")}
            aria-label="Montant"
            placeholder="0,00"
          />
        </div>
      </td>
      <td className="w-44 px-2 text-xs">
        {row.existing ? (
          <span className="rounded-full bg-n-200 px-2 py-0.5 font-semibold text-n-700" title={row.existing.place ?? undefined}>
            Déjà présente ({numericDate(row.existing.date).slice(0, 5)})
          </span>
        ) : row.include && problem ? (
          <span className="font-semibold text-danger-700">{problem}</span>
        ) : row.include && link ? (
          <span
            className="rounded-full bg-accent-100 px-2 py-0.5 font-semibold text-accent-700"
            title={`« ${link.place ?? ""} » du ${numericDate(link.date)} sur ${linkAccountName} sera converti en virement`}
          >
            Relié ({linkAccountName})
          </span>
        ) : row.line === null ? (
          <span className="text-n-600">Ajoutée</span>
        ) : null}
      </td>
      <td className="px-1">
        <button
          type="button"
          onClick={() => actions.remove(row.key)}
          className="flex size-8 items-center justify-center rounded-lg text-n-600 hover:bg-danger-100 hover:text-danger-700"
          aria-label="Supprimer la ligne"
        >
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
});
