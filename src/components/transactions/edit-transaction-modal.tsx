"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteTransaction, updateTransaction } from "@/lib/data/actions";
import { applyCategoryToSimilar, confirmCategory, getSimilarCount } from "@/lib/data/categorize-actions";
import { needsReview, SOURCE_LABELS, type CategorySource } from "@/lib/domain/categorize";
import { centsToInput, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import { needsNature, type EntryInput, type EntryKind } from "@/lib/domain/entries";
import type { Transaction } from "@/lib/domain/types";
import { useAppData } from "@/components/app/app-data";
import { Modal, useToast } from "@/components/ui/overlay";
import { Banner, Button, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";

/** Reconstruit le formulaire à partir d'une ligne (pour un virement : depuis la ligne source). */
function toInput(tx: Transaction, all: Transaction[]): EntryInput {
  const kind: EntryKind = tx.type === "out" ? "out" : tx.type === "transfer" ? "transfer" : "in";
  let accountId: string | null = tx.accountId;
  let toAccountId: string | null = null;
  let source = tx;
  if (tx.type === "transfer") {
    // la ligne négative est la source ; la ligne positive donne la même information inversée
    const outgoing = tx.amountCents < 0 ? tx : all.find((t) => t.transferId === tx.transferId && t.amountCents < 0);
    source = outgoing ?? tx;
    accountId = outgoing ? outgoing.accountId : tx.counterpartAccountId;
    toAccountId = outgoing ? outgoing.counterpartAccountId : tx.accountId;
  }
  return {
    kind,
    amount: centsToInput(Math.abs(source.amountCents)),
    place: source.place ?? "",
    categoryId: source.categoryId,
    accountId,
    toAccountId,
    nature: tx.type === "interest" ? "interest" : "income",
    date: source.date,
    note: source.note ?? "",
  };
}

export function EditTransactionModal({
  tx,
  transactions,
  onClose,
}: {
  tx: Transaction | null;
  transactions: Transaction[];
  onClose: () => void;
}) {
  const { activeAccounts, activeCategories, accountById } = useAppData();
  const toast = useToast();
  const [form, setForm] = useState<EntryInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"save" | "delete" | null>(null);

  useEffect(() => {
    setForm(tx ? toInput(tx, transactions) : null);
    setError(null);
    setConfirmDelete(false);
  }, [tx, transactions]);

  // lignes du même commerçant (même sens) : la nouvelle catégorie peut leur être appliquée d'un coup
  const [similar, setSimilar] = useState<{ merchantKey: string; count: number } | null>(null);
  const [applySimilar, setApplySimilar] = useState(true);
  useEffect(() => {
    setSimilar(null);
    setApplySimilar(true);
    if (!tx || (tx.type !== "out" && tx.type !== "in")) return;
    let cancelled = false;
    getSimilarCount(tx.id)
      .then((r) => !cancelled && r.ok && setSimilar(r.data))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tx]);

  if (!tx || !form) return null;
  const isAdjust = tx.type === "adjust";
  const set = (patch: Partial<EntryInput>) => setForm({ ...form, ...patch });
  const cents = parseAmountToCents(form.amount);
  const canSave = cents !== null && cents > 0 && !isAdjust;
  // comptes proposés : actifs + ceux de la transaction (même archivés)
  const accounts = [
    ...activeAccounts,
    ...[form.accountId, form.toAccountId]
      .map((id) => (id ? accountById.get(id) : undefined))
      .filter((a): a is NonNullable<typeof a> => !!a && !!a.archivedAt),
  ];
  const categories = activeCategories.filter((c) => form.kind === "in" || !c.isIncome);
  const automatic = (tx.type === "out" || tx.type === "in") && !!tx.categorySource && tx.categorySource !== "manual";
  // catégorie changée sur une ligne qui a des semblables (même commerçant) : proposer de les reclasser aussi
  const offerSimilar =
    !!similar && similar.count > 1 && form.kind === (tx.type === "out" ? "out" : "in") && !!form.categoryId && form.categoryId !== tx.categoryId;
  const review = automatic && needsReview(tx.categorySource, tx.categoryConfidence);

  function save() {
    setError(null);
    setAction("save");
    const toSimilar = offerSimilar && applySimilar ? form!.categoryId : null;
    startTransition(async () => {
      const result = await updateTransaction(tx!.id, form!);
      if (!result.ok) return startTransition(() => setError(result.error));
      const bulk = toSimilar ? await applyCategoryToSimilar(tx!.id, toSimilar) : null;
      startTransition(() => {
        if (bulk && !bulk.ok) return setError(bulk.error);
        toast(bulk?.ok ? `${bulk.data.changed} lignes reclassées` : "Transaction modifiée");
        onClose();
      });
    });
  }

  /** Catégorie automatique confirmée telle quelle : la ligne n'est plus à vérifier. */
  function confirm() {
    setError(null);
    setAction("save");
    startTransition(async () => {
      const result = await confirmCategory(tx!.id);
      startTransition(() => {
        if (!result.ok) return setError(result.error);
        toast("Catégorie confirmée");
        onClose();
      });
    });
  }

  function remove() {
    if (!confirmDelete) return setConfirmDelete(true);
    setAction("delete");
    startTransition(async () => {
      const result = await deleteTransaction(tx!.id);
      startTransition(() => {
        if (!result.ok) return setError(result.error);
        toast("Transaction supprimée");
        onClose();
      });
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isAdjust ? "Régularisation" : "Modifier"}
      footer={
        <>
          <Button
            variant={confirmDelete ? "danger" : "secondary"}
            onClick={remove}
            loading={pending && action === "delete"}
            disabled={pending}
            className="mr-auto"
          >
            {confirmDelete ? "Confirmer la suppression" : "Supprimer"}
          </Button>
          {!isAdjust && (
            <Button variant="primary" onClick={save} loading={pending && action === "save"} disabled={!canSave || pending}>
              Enregistrer
            </Button>
          )}
        </>
      }
    >
      {isAdjust ? (
        <p className="text-sm text-n-700">
          Ligne technique créée lors d&apos;un ajustement de solde. Elle ne peut pas être modifiée ; supprime-la puis ajuste à
          nouveau le solde si besoin.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Segmented
            value={form.kind}
            onChange={(kind) => set({ kind, categoryId: kind === "transfer" ? null : form.categoryId })}
            className="w-full"
            options={[
              { value: "out", label: "− Sortie" },
              { value: "in", label: "+ Entrée" },
              { value: "transfer", label: "⇄ Virement" },
            ]}
          />
          <div>
            <Label htmlFor="edit-amount">Montant</Label>
            <Input
              id="edit-amount"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set({ amount: sanitizeAmountInput(e.target.value) })}
              aria-invalid={!canSave}
            />
          </div>
          <div>
            <Label htmlFor="edit-place">{form.kind === "transfer" ? "Libellé" : "Lieu / source"}</Label>
            <Input id="edit-place" value={form.place} onChange={(e) => set({ place: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-account">{form.kind === "transfer" ? "Depuis" : "Compte"}</Label>
              <Select id="edit-account" value={form.accountId ?? ""} onChange={(e) => set({ accountId: e.target.value })}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            {form.kind === "transfer" ? (
              <div>
                <Label htmlFor="edit-to">Vers</Label>
                <Select id="edit-to" value={form.toAccountId ?? ""} onChange={(e) => set({ toAccountId: e.target.value })}>
                  <option value="">Choisir…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div>
                <Label htmlFor="edit-category">Catégorie</Label>
                <Select id="edit-category" value={form.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })}>
                  <option value="">-</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          {offerSimilar && (
            <label className="flex items-start gap-2 rounded-xl bg-accent-100 px-3 py-2.5 text-sm">
              <input type="checkbox" checked={applySimilar} onChange={(e) => setApplySimilar(e.target.checked)} className="mt-0.5" />
              <span>
                Appliquer aussi aux <strong>{similar!.count - 1}</strong> autre{similar!.count > 2 ? "s" : ""} ligne{similar!.count > 2 ? "s" : ""} de «{" "}
                {similar!.merchantKey} »
                <span className="block text-xs text-n-700">Les prochaines lignes de ce commerçant iront aussi dans cette catégorie.</span>
              </span>
            </label>
          )}
          {automatic && (
            <Banner
              tone={review ? "warn" : "info"}
              action={
                review && form.categoryId === tx.categoryId ? (
                  <button type="button" onClick={confirm} disabled={pending} className="shrink-0 font-bold">
                    Confirmer
                  </button>
                ) : undefined
              }
            >
              {review ? "À vérifier · " : ""}Classée automatiquement ({SOURCE_LABELS[tx.categorySource as CategorySource] ?? "automatique"}), confiance{" "}
              {tx.categoryConfidence ?? 0} %. Ton choix vaudra pour toutes les lignes de ce commerçant.
            </Banner>
          )}
          {needsNature(form.kind, form.accountId ? accountById.get(form.accountId) : undefined) && (
            <Segmented
              value={form.nature}
              onChange={(nature) => set({ nature })}
              className="w-full"
              options={[
                { value: "interest", label: "Intérêts d'épargne" },
                { value: "income", label: "Revenu" },
              ]}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-date">Date</Label>
              <Input id="edit-date" type="date" value={form.date} onChange={(e) => e.target.value && set({ date: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="edit-note">Note</Label>
              <Input id="edit-note" value={form.note} onChange={(e) => set({ note: e.target.value })} />
            </div>
          </div>
        </div>
      )}
      <FieldError>{error}</FieldError>
    </Modal>
  );
}
