"use client";

import { clsx } from "clsx";
import { Flag, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteGoal, saveGoal } from "@/lib/data/planning-actions";
import { numericDate, todayIso } from "@/lib/domain/dates";
import type { GoalStatus } from "@/lib/domain/goals";
import { centsToInput, formatCents, formatPercent, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import type { Goal } from "@/lib/domain/types";
import { useAppData } from "@/components/app/app-data";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, FieldError, Input, Label, Select } from "@/components/ui/primitives";

/** Carte d'un objectif : progression, statut et détail du calcul. */
export function GoalCard({ status, onClick }: { status: GoalStatus; onClick?: () => void }) {
  const { accountById } = useAppData();
  const g = status.goal;
  const account = accountById.get(g.accountId);
  return (
    <button type="button" onClick={onClick} className="w-full rounded-card bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-pop">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-[10px] bg-n-100 text-n-700">
            <Flag size={16} />
          </span>
          <div>
            <p className="font-bold">{g.name}</p>
            <p className="flex items-center gap-1 text-[11px] text-n-600">
              <span className="size-1.5 rounded-full" style={{ backgroundColor: account?.color }} />
              {account?.name} · avant le {numericDate(g.targetDate)}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
            status.onTrack ? "bg-accent-100 text-accent-700" : "bg-warn-100 text-warn-800",
          )}
        >
          {status.remainingCents === 0 ? "Atteint" : status.onTrack ? "En avance" : "En retard"}
        </span>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <p>
          <span className="text-xl font-extrabold tabular-nums">{formatCents(status.currentCents)}</span>
          <span className="text-xs text-n-600"> / {formatCents(g.targetCents)}</span>
        </p>
        <span className={clsx("text-sm font-bold", status.onTrack ? "text-accent-700" : "text-warn-800")}>{formatPercent(status.progress, 0)}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-n-200">
        <div className={clsx("h-full rounded-full", status.onTrack ? "bg-accent" : "bg-warn")} style={{ width: `${status.progress * 100}%` }} />
      </div>
      <p className="mt-2 text-[11px] text-n-600">
        {status.remainingCents === 0
          ? "Objectif atteint."
          : `Reste ${formatCents(status.remainingCents)} · ${formatCents(status.neededPerMonthCents)}/mois nécessaires, ${formatCents(Math.max(0, status.plannedPerMonthCents))}/mois programmés`}
        {status.shortfallCents > 0 && ` - il manquera ${formatCents(status.shortfallCents)}.`}
      </p>
    </button>
  );
}

/** Formulaire de création / modification d'un objectif. */
export function GoalFormModal({ goal, onClose, defaultAccountId }: { goal: Goal | null; onClose: () => void; defaultAccountId?: string }) {
  const { activeAccounts } = useAppData();
  const toast = useToast();
  const savings = activeAccounts.filter((a) => a.type === "savings");
  const [name, setName] = useState(goal?.name ?? "");
  const [accountId, setAccountId] = useState(goal?.accountId ?? defaultAccountId ?? savings[0]?.id ?? activeAccounts[0]?.id ?? "");
  const [target, setTarget] = useState(goal ? centsToInput(goal.targetCents) : "");
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const cents = parseAmountToCents(target);

  function save() {
    setError(null);
    setAction("save");
    startTransition(async () => {
      const r = await saveGoal(goal?.id ?? null, { name, accountId, target, targetDate, today: todayIso() });
      startTransition(() => {
        if (!r.ok) return setError(r.error);
        toast(goal ? "Objectif modifié" : "Objectif créé");
        onClose();
      });
    });
  }

  function remove() {
    if (!goal) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setAction("delete");
    startTransition(async () => {
      const r = await deleteGoal(goal.id);
      startTransition(() => {
        if (!r.ok) return setError(r.error);
        toast("Objectif supprimé");
        onClose();
      });
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={goal ? "Modifier l'objectif" : "Nouvel objectif"}
      footer={
        <>
          {goal && (
            <Button variant={confirmDelete ? "danger" : "secondary"} onClick={remove} loading={pending && action === "delete"} disabled={pending} className="mr-auto">
              {confirmDelete ? "Confirmer la suppression" : "Supprimer"}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={save}
            loading={pending && action === "save"}
            disabled={pending || !name.trim() || cents === null || cents <= 0 || !targetDate}
          >
            Enregistrer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="goal-name">Nom</Label>
          <Input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Voyage au Japon, fonds d'urgence…" />
        </div>
        <div>
          <Label htmlFor="goal-account">Compte</Label>
          <Select id="goal-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {activeAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="goal-target">Montant cible</Label>
            <Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(sanitizeAmountInput(e.target.value))} placeholder="0,00" />
          </div>
          <div>
            <Label htmlFor="goal-date">Date cible</Label>
            <Input id="goal-date" type="date" min={todayIso()} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </div>
        </div>
        <p className="text-xs text-n-600">
          La progression suit le solde du compte. Le statut compare le montant nécessaire par mois aux virements récurrents programmés
          vers ce compte (écran Récurrences).
        </p>
        <FieldError>{error}</FieldError>
      </div>
    </Modal>
  );
}

/** Section « Objectifs d'épargne » de l'écran Comptes. */
export function GoalsSection({ statuses }: { statuses: GoalStatus[] }) {
  const [editing, setEditing] = useState<{ goal: Goal | null; key: number } | null>(null);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold">Objectifs d&apos;épargne</h2>
        <Button onClick={() => setEditing({ goal: null, key: Date.now() })}>
          <Plus size={15} /> Nouvel objectif
        </Button>
      </div>
      {statuses.length === 0 ? (
        <p className="rounded-xl bg-n-100 p-4 text-sm text-n-700">
          Aucun objectif. Fixe un montant et une date (voyage, fonds d&apos;urgence…) pour suivre ta progression.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {statuses.map((s) => (
            <GoalCard key={s.goal.id} status={s} onClick={() => setEditing({ goal: s.goal, key: Date.now() })} />
          ))}
        </div>
      )}
      {editing && <GoalFormModal key={editing.key} goal={editing.goal} onClose={() => setEditing(null)} />}
    </section>
  );
}
