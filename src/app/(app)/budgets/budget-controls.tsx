"use client";

import { clsx } from "clsx";
import { useState, useTransition, type ReactNode } from "react";
import { saveBudget, updateProfile } from "@/lib/data/actions";
import { centsToInput, formatCents, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import type { BudgetMode } from "@/lib/domain/types";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, FieldError, Input, Label, Segmented } from "@/components/ui/primitives";
import { Spinner } from "@/components/ui/spinner";

/** Ligne cliquable ouvrant l'édition du budget d'une catégorie (montant fixe ou % du revenu). */
export function BudgetEditButton({
  categoryId,
  categoryName,
  mode: initialMode,
  amountCents,
  referenceIncomeCents,
  compact = false,
  children,
}: {
  categoryId: string;
  categoryName: string;
  mode: BudgetMode;
  /** Montant en centimes, ou pourcentage × 100 en mode percent ; null = pas de budget */
  amountCents: number | null;
  referenceIncomeCents: number;
  compact?: boolean;
  children: ReactNode;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<BudgetMode>(initialMode);
  const [value, setValue] = useState(amountCents === null ? "" : centsToInput(amountCents).replace(/,00$/, ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<"save" | "delete" | null>(null);

  const parsed = parseAmountToCents(value);
  const preview = mode === "percent" && parsed !== null ? Math.round((referenceIncomeCents * parsed) / 10000) : null;

  function save(amount: string) {
    setError(null);
    setAction(amount ? "save" : "delete");
    startTransition(async () => {
      const r = await saveBudget({ categoryId, mode, amount });
      startTransition(() => {
        if (!r.ok) return setError(r.error);
        toast(amount ? `Budget ${categoryName} enregistré` : `Budget ${categoryName} supprimé`);
        setOpen(false);
      });
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={clsx(
          "w-full text-left",
          compact ? "min-h-10 rounded-full border border-n-300 px-3.5 text-sm font-semibold hover:bg-n-100" : "px-4 py-3.5 hover:bg-n-100",
        )}
      >
        {children}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Budget - ${categoryName}`}
        footer={
          <>
            {amountCents !== null && (
              <Button onClick={() => save("")} loading={pending && action === "delete"} disabled={pending} className="mr-auto">
                Supprimer le budget
              </Button>
            )}
            <Button variant="primary" onClick={() => save(value)} loading={pending && action === "save"} disabled={parsed === null || pending}>
              Enregistrer
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Segmented
            value={mode}
            onChange={setMode}
            className="w-full"
            options={[
              { value: "fixed", label: "Montant fixe" },
              { value: "percent", label: "% du salaire" },
            ]}
          />
          <div>
            <Label htmlFor="budget-value">{mode === "fixed" ? "Montant mensuel (€)" : "Pourcentage du revenu de référence"}</Label>
            <Input id="budget-value" inputMode="decimal" value={value} onChange={(e) => setValue(sanitizeAmountInput(e.target.value))} />
            {preview !== null && (
              <p className="mt-1.5 text-xs text-n-600">
                Soit {formatCents(preview)} / mois sur un revenu de {formatCents(referenceIncomeCents)}.
              </p>
            )}
          </div>
          <p className="text-xs text-n-600">
            S&apos;applique dès le mois en cours. Les comptes concernés se règlent dans l&apos;écran Catégories.
          </p>
          <FieldError>{error}</FieldError>
        </div>
      </Modal>
    </>
  );
}

/** Report du reste + revenu de référence (base des budgets en %). */
export function BudgetSettings({
  carryOver,
  carryOverCents,
  referenceIncomeCents,
}: {
  carryOver: boolean;
  carryOverCents: number;
  referenceIncomeCents: number;
}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [income, setIncome] = useState(centsToInput(referenceIncomeCents));
  const [error, setError] = useState<string | null>(null);
  const [what, setWhat] = useState<"carry" | "income" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-start justify-between gap-3 text-sm">
        <span>
          <span className="block font-semibold">Reporter le reste</span>
          <span className="text-xs text-n-600">
            {carryOver ? `${formatCents(carryOverCents)} reportés du mois précédent` : "Ajoute le reliquat du mois précédent"}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {pending && what === "carry" && <Spinner size={14} label="Enregistrement" />}
          <input
            type="checkbox"
            checked={carryOver}
            disabled={pending}
            onChange={(e) => {
              setWhat("carry");
              startTransition(async () => {
                const r = await updateProfile({ budgetCarryOver: e.target.checked });
                startTransition(() => {
                  if (!r.ok) toast(r.error, "error");
                });
              });
            }}
          />
        </span>
      </label>
      <form
        className="border-t border-divider pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setWhat("income");
          startTransition(async () => {
            const r = await updateProfile({ referenceIncome: income });
            startTransition(() => {
              if (!r.ok) return setError(r.error);
              toast("Revenu de référence enregistré");
            });
          });
        }}
      >
        <Label htmlFor="ref-income">Revenu de référence (budgets en %)</Label>
        <div className="flex gap-2">
          <Input id="ref-income" inputMode="decimal" value={income} onChange={(e) => setIncome(sanitizeAmountInput(e.target.value))} />
          <Button type="submit" loading={pending && what === "income"} disabled={pending}>
            OK
          </Button>
        </div>
        <FieldError>{error}</FieldError>
      </form>
    </div>
  );
}
