"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteTransaction, updateTransaction } from "@/lib/data/actions";
import { centsToInput, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import { needsNature, type EntryInput, type EntryKind } from "@/lib/domain/entries";
import type { Transaction } from "@/lib/domain/types";
import { useAppData } from "@/components/app/app-data";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";

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

  function save() {
    setError(null);
    setAction("save");
    startTransition(async () => {
      const result = await updateTransaction(tx!.id, form!);
      startTransition(() => {
        if (!result.ok) return setError(result.error);
        toast("Transaction modifiée");
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
