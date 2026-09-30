"use client";

import { useState, useTransition } from "react";
import { deleteRecurrence, saveRecurrence, type RecurrenceInput } from "@/lib/data/planning-actions";
import { FREQUENCY_LABELS } from "@/lib/domain/recurrences";
import { centsToInput, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import { todayIso } from "@/lib/domain/dates";
import type { Recurrence, RecurrenceFrequency } from "@/lib/domain/types";
import { useAppData } from "@/components/app/app-data";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";

type Draft = Omit<RecurrenceInput, "dueDay"> & { dueDay: string };

function toDraft(r: Recurrence | null, defaultAccountId: string): Draft {
  if (!r) {
    const today = todayIso();
    return {
      type: "out",
      label: "",
      amount: "",
      categoryId: null,
      accountId: defaultAccountId,
      toAccountId: null,
      frequency: "monthly",
      dueDay: String(Number(today.slice(8, 10))),
      startDate: today,
      endDate: null,
      isSubscription: false,
    };
  }
  return {
    type: r.type,
    label: r.label,
    amount: centsToInput(r.amountCents),
    categoryId: r.categoryId,
    accountId: r.accountId,
    toAccountId: r.toAccountId,
    frequency: r.frequency,
    dueDay: String(r.dueDay),
    startDate: r.startDate,
    endDate: r.endDate,
    isSubscription: r.isSubscription,
  };
}

/** Modale de création / modification d'une récurrence. */
export function RecurrenceFormModal({
  open,
  recurrence,
  onClose,
}: {
  open: boolean;
  recurrence: Recurrence | null;
  onClose: () => void;
}) {
  const { activeAccounts, activeCategories } = useAppData();
  const toast = useToast();
  const defaultAccount = activeAccounts.find((a) => a.type === "current") ?? activeAccounts[0];
  const [draft, setDraft] = useState<Draft>(() => toDraft(recurrence, defaultAccount?.id ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const cents = parseAmountToCents(draft.amount);
  const canSave = !!draft.label.trim() && cents !== null && cents > 0;
  const categories = activeCategories.filter((c) => (draft.type === "out" ? !c.isIncome : true));

  function save() {
    setError(null);
    setAction("save");
    startTransition(async () => {
      const r = await saveRecurrence(recurrence?.id ?? null, { ...draft, dueDay: Number(draft.dueDay) || 1 });
      if (!r.ok) return setError(r.error);
      toast(recurrence ? "Récurrence modifiée" : "Récurrence créée");
      onClose();
    });
  }

  function remove() {
    if (!recurrence) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setAction("delete");
    startTransition(async () => {
      const r = await deleteRecurrence(recurrence.id);
      if (!r.ok) return setError(r.error);
      toast("Récurrence supprimée");
      onClose();
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={recurrence ? "Modifier la récurrence" : "Nouvelle récurrence"}
      footer={
        <>
          {recurrence && (
            <Button
              variant={confirmDelete ? "danger" : "secondary"}
              onClick={remove}
              loading={pending && action === "delete"}
              disabled={pending}
              className="mr-auto"
            >
              {confirmDelete ? "Confirmer la suppression" : "Supprimer"}
            </Button>
          )}
          <Button variant="primary" onClick={save} loading={pending && action === "save"} disabled={!canSave || pending}>
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          value={draft.type}
          onChange={(type) => set({ type, categoryId: null, isSubscription: type === "out" && draft.isSubscription })}
          className="w-full"
          options={[
            { value: "out", label: "− Sortie" },
            { value: "in", label: "+ Entrée" },
            { value: "transfer", label: "⇄ Virement" },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="rec-label">Libellé</Label>
            <Input id="rec-label" value={draft.label} onChange={(e) => set({ label: e.target.value })} placeholder="Loyer, Netflix, Salaire…" />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="rec-amount">Montant</Label>
            <Input id="rec-amount" inputMode="decimal" value={draft.amount} onChange={(e) => set({ amount: sanitizeAmountInput(e.target.value) })} placeholder="0,00" />
          </div>
          <div>
            <Label htmlFor="rec-account">{draft.type === "transfer" ? "Depuis" : "Compte"}</Label>
            <Select id="rec-account" value={draft.accountId} onChange={(e) => set({ accountId: e.target.value })}>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          {draft.type === "transfer" ? (
            <div>
              <Label htmlFor="rec-to">Vers</Label>
              <Select id="rec-to" value={draft.toAccountId ?? ""} onChange={(e) => set({ toAccountId: e.target.value || null })}>
                <option value="">Choisir…</option>
                {activeAccounts
                  .filter((a) => a.id !== draft.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </div>
          ) : (
            <div>
              <Label htmlFor="rec-category">Catégorie</Label>
              <Select id="rec-category" value={draft.categoryId ?? ""} onChange={(e) => set({ categoryId: e.target.value || null })}>
                <option value="">Choisir…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label htmlFor="rec-frequency">Fréquence</Label>
            <Select id="rec-frequency" value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as RecurrenceFrequency })}>
              {(Object.keys(FREQUENCY_LABELS) as RecurrenceFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABELS[f]}
                </option>
              ))}
            </Select>
          </div>
          {draft.frequency !== "weekly" && (
            <div>
              <Label htmlFor="rec-day">Jour d&apos;échéance</Label>
              <Input
                id="rec-day"
                type="number"
                min={1}
                max={31}
                value={draft.dueDay}
                onChange={(e) => set({ dueDay: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label htmlFor="rec-start">Début</Label>
            <Input id="rec-start" type="date" value={draft.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="rec-end">Fin (facultatif)</Label>
            <Input id="rec-end" type="date" value={draft.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
          </div>
        </div>
        {draft.type === "out" && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={draft.isSubscription} onChange={(e) => set({ isSubscription: e.target.checked })} />
            Abonnement
          </label>
        )}
        <p className="text-xs text-n-600">
          {draft.frequency === "weekly"
            ? "Une échéance tous les 7 jours à partir de la date de début."
            : "Si le jour n'existe pas dans le mois (ex. 31), l'échéance tombe le dernier jour du mois."}
        </p>
        <FieldError>{error}</FieldError>
      </div>
    </Modal>
  );
}
