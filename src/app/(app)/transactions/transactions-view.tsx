"use client";

import { Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { recategorizeTransactions } from "@/lib/data/categorize-actions";
import { Modal, useToast } from "@/components/ui/overlay";
import { useAppData } from "@/components/app/app-data";
import { Button, Chip, EmptyState, Segmented, Select } from "@/components/ui/primitives";
import { Amount } from "@/components/ui/money";
import { dayLabel } from "@/lib/domain/dates";
import { formatCents } from "@/lib/domain/money";
import { shortAccountName } from "@/lib/domain/accounts";
import { needsReview } from "@/lib/domain/categorize";
import { groupByDay, signedTotal } from "@/lib/domain/stats";
import type { Transaction } from "@/lib/domain/types";
import { TransactionRow } from "@/components/transactions/transaction-row";
import { SwipeActions } from "@/components/ui/swipe-actions";
import { deleteTransaction } from "@/lib/data/actions";
import { EditTransactionModal } from "@/components/transactions/edit-transaction-modal";

type TypeFilter = "all" | "out" | "in" | "transfer";

/** Lignes affichées d'un coup (« Afficher plus » ajoute le paquet suivant) */
const PAGE = 200;

export function TransactionsView({
  transactions,
  initialAccount,
  initialCategory = null,
}: {
  transactions: Transaction[];
  initialAccount: string | null;
  /** Catégorie filtrée à l'ouverture (lien « Voir ses transactions » de la page Catégories) */
  initialCategory?: string | null;
}) {
  const { activeAccounts, activeCategories, categoryById, accountById } = useAppData();
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string | null>(initialAccount);
  const [type, setType] = useState<TypeFilter>("all");
  const [categoryId, setCategoryId] = useState<string>(initialCategory ?? "");
  const [reviewOnly, setReviewOnly] = useState(false);
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
      if (reviewOnly && !needsReview(t.categorySource, t.categoryConfidence)) return false;
      if (q && !`${t.place ?? ""} ${t.note ?? ""}`.toLocaleLowerCase("fr-FR").includes(q)) return false;
      return true;
    });
  }, [transactions, search, accountId, type, categoryId, reviewOnly]);
  const reviewCount = useMemo(() => transactions.filter((t) => needsReview(t.categorySource, t.categoryConfidence)).length, [transactions]);

  const total = signedTotal(filtered, accountId);
  // reclassement en masse : les dépenses / recettes affichées quand un filtre est actif
  const filtering = !!search.trim() || !!categoryId || reviewOnly;
  const bulkTargets = filtering ? filtered.filter((t) => (t.type === "out" || t.type === "in") && t.categorySource !== "rent" && !t.splitOf) : [];
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkPending, startBulk] = useTransition();
  const toast = useToast();
  const bulkHasIncome = bulkTargets.some((t) => t.type === "in");

  function applyBulk() {
    if (!bulkCategory) return;
    startBulk(async () => {
      const r = await recategorizeTransactions(
        bulkTargets.map((t) => t.id),
        bulkCategory,
      );
      startBulk(() => {
        toast(r.ok ? `${r.data.changed} ligne${r.data.changed > 1 ? "s" : ""} reclassée${r.data.changed > 1 ? "s" : ""}` : r.error, r.ok ? "success" : "error");
        if (r.ok) setBulkOpen(false);
      });
    });
  }
  // rendu par paquets : une longue période (tout l'historique) reste fluide ; le total porte sur tout
  const [shown, setShown] = useState(PAGE);
  const filterKey = `${search}|${accountId}|${type}|${categoryId}|${reviewOnly}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setShown(PAGE);
  }
  const groups = groupByDay(filtered.slice(0, shown));
  const remaining = filtered.length - shown;

  return (
    <>
      <div className="flex flex-col gap-3 md:rounded-card md:bg-surface md:p-4 md:shadow-card">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_200px]">
          <label className="relative block">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-n-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un lieu, une note"
              className="block min-h-11 w-full rounded-[10px] border border-n-300 bg-surface pr-3 pl-9 text-base placeholder:text-n-500 focus:border-accent focus:outline-none md:min-h-9 md:text-sm"
            />
          </label>
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes les catégories</option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {reviewCount > 0 && (
          <div className="self-start">
            <Chip active={reviewOnly} onClick={() => setReviewOnly((v) => !v)}>
              À vérifier ({reviewCount})
            </Chip>
          </div>
        )}
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
      {bulkTargets.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setBulkCategory("");
            setBulkOpen(true);
          }}
          className="self-start text-sm font-semibold text-accent-700 hover:underline"
        >
          Reclasser ces {bulkTargets.length} ligne{bulkTargets.length > 1 ? "s" : ""}…
        </button>
      )}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title={`Reclasser ${bulkTargets.length} ligne${bulkTargets.length > 1 ? "s" : ""}`}
        footer={
          <>
            <Button onClick={() => setBulkOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={applyBulk} loading={bulkPending} disabled={!bulkCategory}>
              Reclasser
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Toutes les dépenses et recettes affichées par ce filtre vont dans la catégorie choisie. Pecunia retient ce choix pour leurs commerçants : les
            prochaines lignes suivront.
          </p>
          <Select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} aria-label="Nouvelle catégorie">
            <option value="">Choisir une catégorie…</option>
            {activeCategories
              .filter((c) => bulkHasIncome || !c.isIncome)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.isIncome ? " (revenu)" : ""}
                </option>
              ))}
          </Select>
          <p className="text-xs text-n-600">Les virements internes et les parts de loyer ne sont pas concernés.</p>
        </div>
      </Modal>

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
                      <SwipeActions
                        label={`Supprimer ${t.place || "la transaction"}`}
                        successMessage={t.type === "transfer" ? "Virement supprimé" : "Transaction supprimée"}
                        onDelete={() => deleteTransaction(t.id)}
                      >
                        <TransactionRow
                          tx={t}
                          consolidated={!accountId}
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
            );
          })}
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setShown((n) => n + PAGE)}
              className="min-h-11 rounded-card bg-surface font-semibold text-accent-700 shadow-card hover:bg-n-100"
            >
              Afficher plus ({remaining} restante{remaining > 1 ? "s" : ""})
            </button>
          )}
        </div>
      )}

      <EditTransactionModal tx={editing} transactions={transactions} onClose={() => setEditing(null)} />
    </>
  );
}
