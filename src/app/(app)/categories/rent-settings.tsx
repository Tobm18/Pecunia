"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { removeRent, saveRent } from "@/lib/data/rent-actions";
import type { Recipient, RentRuleView } from "@/lib/data/rent";
import { centsToInput, formatCents, sanitizeAmountInput } from "@/lib/domain/money";
import { describeRentRule, type RentMode } from "@/lib/domain/rent";
import type { Category } from "@/lib/domain/types";
import { Button, Card, Input, Label, Segmented, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

/**
 * Loyer payé à un proche (loyer partagé) : le proche qui reçoit tes virements et la part de loyer
 * (montant par mois ou pourcentage). La part est détachée de chaque virement en ligne « Logement ».
 */
export function RentSettings({ rules, recipients, categories }: { rules: RentRuleView[]; recipients: Recipient[]; categories: Category[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const expenseCategories = categories.filter((c) => !c.isIncome && !c.archivedAt);
  const logement = expenseCategories.find((c) => c.name.toLowerCase() === "logement") ?? expenseCategories[0];
  const [merchantKey, setMerchantKey] = useState(rules[0]?.merchantKey ?? recipients[0]?.merchantKey ?? "");
  const [mode, setMode] = useState<RentMode>(rules[0]?.mode ?? "monthly");
  const [value, setValue] = useState(rules[0] ? (rules[0].mode === "monthly" ? centsToInput(rules[0].value) : String(rules[0].value)) : "");
  const [categoryId, setCategoryId] = useState(rules[0]?.categoryId ?? logement?.id ?? "");
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "";
  const recipient = recipients.find((r) => r.merchantKey === merchantKey);

  function save() {
    startTransition(async () => {
      const r = await saveRent({ merchantKey, mode, value, categoryId });
      startTransition(() => toast(r.ok ? "Règle de loyer enregistrée" : r.error, r.ok ? "success" : "error"));
    });
  }

  function remove(rule: RentRuleView) {
    startTransition(async () => {
      const r = await removeRent(rule.id);
      startTransition(() => toast(r.ok ? "Règle supprimée, virements recomposés" : r.error, r.ok ? "success" : "error"));
    });
  }

  return (
    <Card>
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Loyer payé à un proche</h2>
      <p className="mt-1 text-xs text-n-600">
        Tu verses ta part de loyer à quelqu&apos;un ? Indique-le : la part loyer de chaque virement passe en {logement?.name ?? "Logement"}, le reste garde sa
        catégorie. Le montant total des virements ne change pas.
      </p>

      {rules.length > 0 && (
        <ul className="mt-3 divide-y divide-divider">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{rule.merchantKey}</p>
                <p className="text-xs text-n-600">
                  {describeRentRule(rule, (c) => formatCents(c))} → {categoryName(rule.categoryId)} · {rule.transfers} virement{rule.transfers > 1 ? "s" : ""},{" "}
                  {formatCents(rule.rentCents)} comptés en loyer
                </p>
              </div>
              <Button variant="ghost" onClick={() => remove(rule)} disabled={pending} aria-label={`Supprimer la règle ${rule.merchantKey}`} className="text-danger-700!">
                <Trash2 size={15} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {recipients.length === 0 ? (
        <p className="mt-3 text-sm text-n-600">Aucun virement à un proche trouvé pour l&apos;instant.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <Label htmlFor="rent-recipient">Proche</Label>
            <Select id="rent-recipient" value={merchantKey} onChange={(e) => setMerchantKey(e.target.value)}>
              {recipients.map((r) => (
                <option key={r.merchantKey} value={r.merchantKey}>
                  {r.merchantKey} · {r.count} virement{r.count > 1 ? "s" : ""} ({formatCents(-r.totalCents)})
                </option>
              ))}
            </Select>
            {recipient && <p className="mt-1 truncate text-[11px] text-n-600">ex. « {recipient.label} »</p>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                setValue("");
              }}
              size="sm"
              options={[
                { value: "monthly", label: "Montant par mois" },
                { value: "percent", label: "Pourcentage" },
              ]}
            />
            <div className="flex w-32 items-center gap-2">
              <Input
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(mode === "monthly" ? sanitizeAmountInput(e.target.value) : e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
                placeholder={mode === "monthly" ? "450,00" : "50"}
                aria-label={mode === "monthly" ? "Part de loyer par mois, en euros" : "Part de loyer, en pourcentage"}
                className="text-right tabular-nums"
              />
              <span className="text-sm text-n-700">{mode === "monthly" ? "€" : "%"}</span>
            </div>
            <div className="min-w-40 flex-1">
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
          <p className="text-xs text-n-600">
            {mode === "monthly"
              ? "Chaque mois, les virements à ce proche comptent en loyer jusqu'à ce montant (dans l'ordre des dates) ; au-delà, ce n'est plus du loyer."
              : "Ce pourcentage de chaque virement à ce proche compte en loyer."}
          </p>
          <div className="flex justify-end">
            <Button variant="primary" onClick={save} loading={pending} disabled={!merchantKey || !value || !categoryId}>
              Enregistrer
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
