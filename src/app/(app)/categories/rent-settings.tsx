"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { addPeriod, changeRentCategory, changeRentEnd, createRent, removePeriod, removeRent } from "@/lib/data/rent-actions";
import type { Recipient, RentRuleView } from "@/lib/data/rent";
import { numericDate, todayIso } from "@/lib/domain/dates";
import { formatCents, sanitizeAmountInput } from "@/lib/domain/money";
import { describeRentPeriod, periodAt, type RentMode } from "@/lib/domain/rent";
import type { Category } from "@/lib/domain/types";
import { Button, Card, Input, Label, Segmented, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

/** Date de début « depuis toujours » (première période sans date) */
const SINCE_ALWAYS = "2000-01-01";
const sinceLabel = (start: string) => (start <= SINCE_ALWAYS ? "Depuis toujours" : `À partir du ${numericDate(start)}`);

type Run = (action: () => Promise<{ ok: boolean; error?: string }>, success: string) => void;

/** Saisie d'une période : date de début, montant mensuel ou pourcentage (0 = plus rien de compté). */
function PeriodFields({
  start,
  mode,
  value,
  onChange,
  allowAlways,
}: {
  start: string;
  mode: RentMode;
  value: string;
  onChange: (patch: Partial<{ start: string; mode: RentMode; value: string }>) => void;
  allowAlways?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <Label>À partir du</Label>
        <Input type="date" value={start} max={todayIso()} onChange={(e) => onChange({ start: e.target.value })} className="w-40" />
        {allowAlways && <p className="mt-1 text-[11px] text-n-600">Vide : depuis toujours</p>}
      </div>
      <Segmented
        value={mode}
        onChange={(m) => onChange({ mode: m, value: "" })}
        size="sm"
        options={[
          { value: "monthly", label: "Par mois" },
          { value: "percent", label: "Pourcentage" },
        ]}
      />
      <div className="flex w-32 items-center gap-2">
        <Input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange({ value: mode === "monthly" ? sanitizeAmountInput(e.target.value) : e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
          placeholder={mode === "monthly" ? "450,00" : "50"}
          aria-label={mode === "monthly" ? "Part comptée par mois, en euros" : "Part comptée, en pourcentage"}
          className="text-right tabular-nums"
        />
        <span className="text-sm text-n-700">{mode === "monthly" ? "€" : "%"}</span>
      </div>
    </div>
  );
}

/** Fin facultative d'une règle : affichée, modifiable, retirable. */
function EndDate({ rule, pending, run }: { rule: RentRuleView; pending: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(rule.endDate ?? todayIso());
  if (editing) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-n-700">Fin le</span>
        <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="w-40" aria-label="Date de fin de la règle" />
        <Button
          variant="primary"
          disabled={pending || !value}
          onClick={() => {
            run(() => changeRentEnd(rule.id, value), "Date de fin enregistrée");
            setEditing(false);
          }}
        >
          OK
        </Button>
        <Button onClick={() => setEditing(false)}>Annuler</Button>
      </div>
    );
  }
  return (
    <p className="text-xs text-n-700">
      {rule.endDate ? (
        <>
          Fin le <strong>{numericDate(rule.endDate)}</strong> ·{" "}
          <button type="button" onClick={() => setEditing(true)} className="font-semibold text-accent-700 hover:underline">
            modifier
          </button>{" "}
          ·{" "}
          <button
            type="button"
            onClick={() => run(() => changeRentEnd(rule.id, ""), "Règle sans fin")}
            disabled={pending}
            className="font-semibold text-accent-700 hover:underline"
          >
            retirer
          </button>
        </>
      ) : (
        <>
          Sans date de fin ·{" "}
          <button type="button" onClick={() => setEditing(true)} className="font-semibold text-accent-700 hover:underline">
            ajouter une fin
          </button>
        </>
      )}
    </p>
  );
}

function RuleCard({ rule, categories, pending, run }: { rule: RentRuleView; categories: Category[]; pending: boolean; run: Run }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ start: string; mode: RentMode; value: string }>({ start: todayIso().slice(0, 8) + "01", mode: "monthly", value: "" });
  const ended = !!rule.endDate && rule.endDate < todayIso();
  const current = ended ? null : periodAt(rule.periods, todayIso());
  const categoryName = categories.find((c) => c.id === rule.categoryId)?.name ?? "la catégorie";

  return (
    <div className="rounded-xl border border-divider p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{rule.merchantKey}</p>
          <p className="text-xs text-n-600">
            {rule.transfers} virement{rule.transfers > 1 ? "s" : ""} concerné{rule.transfers > 1 ? "s" : ""} · {formatCents(rule.rentCents)} comptés en {categoryName}
            {rule.firstTransfer && rule.lastTransfer && ` · virements du ${numericDate(rule.firstTransfer)} au ${numericDate(rule.lastTransfer)}`}
          </p>
          <p className="text-xs font-semibold text-accent-700">
            {ended ? "Règle terminée" : `Aujourd'hui : ${current ? describeRentPeriod(current, (c) => formatCents(c)) : "rien de compté"}`}
          </p>
          <EndDate rule={rule} pending={pending} run={run} />
          {rule.aliases.length > 1 && (
            <p className="text-[11px] text-n-600">Libellés reconnus : {rule.aliases.join(", ")}</p>
          )}
          <p className="text-[11px] text-n-600">
            Virements sans nom (« VIR. VERS MLLE ») : comptés s&apos;ils font exactement le montant d&apos;un mois pas encore payé.
          </p>
        </div>
        <Select
          value={rule.categoryId}
          onChange={(e) => run(() => changeRentCategory(rule.id, e.target.value), "Catégorie modifiée")}
          aria-label="Catégorie de la part comptée"
          className="w-40"
          disabled={pending}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Button
          variant="ghost"
          onClick={() => run(() => removeRent(rule.id), "Règle supprimée, virements recomposés")}
          disabled={pending}
          aria-label={`Supprimer la règle ${rule.merchantKey}`}
          className="text-danger-700!"
        >
          <Trash2 size={15} />
        </Button>
      </div>

      <ol className="mt-3 flex flex-col gap-1 border-l-2 border-accent-100 pl-3 text-sm">
        {rule.periods.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <span className="flex-1">
              <span className="text-n-600">{sinceLabel(p.start)} :</span> <strong>{describeRentPeriod(p, (c) => formatCents(c))}</strong>
            </span>
            {rule.periods.length > 1 && (
              <button
                type="button"
                onClick={() => run(() => removePeriod(p.id), "Période retirée")}
                disabled={pending}
                className="rounded p-1 text-n-500 hover:bg-n-100 hover:text-danger-700"
                aria-label={`Retirer la période ${sinceLabel(p.start)}`}
              >
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
      </ol>

      {adding ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-n-100 p-3">
          <PeriodFields {...draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <p className="text-[11px] text-n-600">Hausse, autre montant, ou 0 pour arrêter à partir de cette date.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>Annuler</Button>
            <Button
              variant="primary"
              disabled={pending || !draft.start || !draft.value}
              onClick={() => {
                run(() => addPeriod(rule.id, draft), "Période ajoutée");
                setAdding(false);
              }}
            >
              Ajouter
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-accent-700 hover:underline">
          <Plus size={13} /> Ajouter une période (hausse, changement, fin)
        </button>
      )}
    </div>
  );
}

/**
 * Virements réguliers à un proche (loyer partagé, remboursement d'un crédit…) : le proche qui reçoit
 * tes virements, la catégorie, l'historique de la part (périodes datées) et une fin facultative. La
 * part est détachée de chaque virement.
 */
export function RentSettings({ rules, recipients, categories }: { rules: RentRuleView[]; recipients: Recipient[]; categories: Category[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const expenseCategories = categories.filter((c) => !c.isIncome && !c.archivedAt);
  const logement = expenseCategories.find((c) => c.name.toLowerCase() === "logement") ?? expenseCategories[0];
  const available = recipients.filter((r) => !rules.some((rule) => rule.merchantKey === r.merchantKey));
  const [creating, setCreating] = useState(rules.length === 0);
  const [merchantKey, setMerchantKey] = useState(available[0]?.merchantKey ?? "");
  const [categoryId, setCategoryId] = useState(logement?.id ?? "");
  const [first, setFirst] = useState<{ start: string; mode: RentMode; value: string }>({ start: "", mode: "monthly", value: "" });
  const [endDate, setEndDate] = useState("");
  const recipient = recipients.find((r) => r.merchantKey === merchantKey);

  const run: Run = (action, success) =>
    startTransition(async () => {
      const r = await action();
      startTransition(() => toast(r.ok ? success : (r.error ?? "Erreur"), r.ok ? "success" : "error"));
    });

  return (
    <Card>
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Virements réguliers à un proche</h2>
      <p className="mt-1 text-xs text-n-600">
        Loyer partagé, remboursement d&apos;un crédit à un proche… : la part concernée de chaque virement passe dans la catégorie de la règle, le reste
        garde la sienne ; le montant des virements ne change pas. Le montant évolue (hausse, déménagement) : ajoute une période datée, elle s&apos;applique aux virements à partir
        de sa date.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} categories={expenseCategories} pending={pending} run={run} />
        ))}
      </div>

      {creating ? (
        available.length === 0 ? (
          <p className="mt-3 text-sm text-n-600">Aucun autre virement à un proche trouvé pour l&apos;instant.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border border-dashed border-n-300 p-3">
            <div className="flex flex-wrap gap-3">
              <div className="min-w-56 flex-1">
                <Label htmlFor="rent-recipient">Proche</Label>
                <Select id="rent-recipient" value={merchantKey} onChange={(e) => setMerchantKey(e.target.value)}>
                  {available.map((r) => (
                    <option key={r.merchantKey} value={r.merchantKey}>
                      {r.merchantKey} · {r.count} virement{r.count > 1 ? "s" : ""} ({formatCents(-r.totalCents)})
                    </option>
                  ))}
                </Select>
                {recipient && <p className="mt-1 truncate text-[11px] text-n-600">ex. « {recipient.label} »</p>}
              </div>
              <div className="w-44">
                <Label htmlFor="rent-category">Catégorie</Label>
                <Select id="rent-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <PeriodFields {...first} allowAlways onChange={(patch) => setFirst((f) => ({ ...f, ...patch }))} />
            <div>
              <Label htmlFor="rent-end">Fin (facultative)</Label>
              <Input id="rent-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
              <p className="mt-1 text-[11px] text-n-600">Après cette date, les virements à ce proche gardent leur catégorie. Vide : sans fin.</p>
            </div>
            <p className="text-[11px] text-n-600">
              {first.mode === "monthly"
                ? "Chaque mois, les virements à ce proche comptent dans la catégorie jusqu'à ce montant (le montant exact d'abord, sinon les plus gros, avec avance et rattrapage d'un mois) ; au-delà, ils gardent leur catégorie."
                : "Ce pourcentage de chaque virement à ce proche compte dans la catégorie."}{" "}
              Tu ajouteras ensuite les autres périodes (montants passés, hausses).
            </p>
            <div className="flex justify-end gap-2">
              {rules.length > 0 && <Button onClick={() => setCreating(false)}>Annuler</Button>}
              <Button
                variant="primary"
                loading={pending}
                disabled={!merchantKey || !categoryId || !first.value}
                onClick={() => run(() => createRent({ merchantKey, categoryId, period: { ...first, start: first.start || SINCE_ALWAYS }, endDate }), "Règle enregistrée")}
              >
                Enregistrer
              </Button>
            </div>
          </div>
        )
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-700 hover:underline">
          <Plus size={15} /> Nouvelle règle (autre proche, autre logement, remboursement…)
        </button>
      )}
    </Card>
  );
}
