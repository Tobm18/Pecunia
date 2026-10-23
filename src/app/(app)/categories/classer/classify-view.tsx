"use client";

import { useMemo, useState, useTransition } from "react";
import { createCategoriesFromSuggestions, validateMerchantCategories } from "@/lib/data/categorize-actions";
import type { ReviewGroup, ReviewOverview } from "@/lib/data/categorize";
import { shortDate } from "@/lib/domain/dates";
import { formatCents, formatPercent } from "@/lib/domain/money";
import type { Category } from "@/lib/domain/types";
import { IconBadge } from "@/components/ui/icons";
import { Banner, Button, Card, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

const PAGE = 60;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/**
 * Lignes à vérifier : le classement automatique n'était pas assez sûr (score de confiance sous le
 * seuil). Regroupées par commerçant, avec la catégorie retenue pré-sélectionnée ; valider (en la
 * changeant ou non) classe toutes les lignes du commerçant et retient le choix pour la suite.
 */
export function ClassifyView({ overview, unprocessed, categories }: { overview: ReviewOverview; unprocessed: number; categories: Category[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(overview.suggestions.map((s) => s.name)));
  const [choices, setChoices] = useState<Record<string, string>>({});
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const share = overview.total ? overview.toReview / overview.total : 0;
  const choiceOf = (g: ReviewGroup) => choices[g.id] ?? g.categoryId ?? "";

  function validate(group: ReviewGroup) {
    const categoryId = choiceOf(group);
    if (!categoryId) return;
    startTransition(async () => {
      const r = await validateMerchantCategories([{ merchantKey: group.merchantKey, direction: group.direction, categoryId }]);
      startTransition(() => toast(r.ok ? `${group.merchantKey} : ${plural(r.data.changed, "ligne classée", "lignes classées")}` : r.error, r.ok ? "success" : "error"));
    });
  }

  function createCategories() {
    startTransition(async () => {
      const r = await createCategoriesFromSuggestions([...picked]);
      startTransition(() => toast(r.ok ? `${plural(r.data.created, "catégorie créée", "catégories créées")}` : r.error, r.ok ? "success" : "error"));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <p className="text-3xl font-extrabold tabular-nums">{overview.toReview}</p>
        <p className="text-sm text-n-700">
          transaction{overview.toReview > 1 ? "s" : ""} à vérifier sur {overview.total} ({formatPercent(share, 0)}). Les autres sont classées
          automatiquement avec assez de confiance.
        </p>
        {unprocessed > 0 && (
          <p className="mt-2 text-xs text-n-600">
            {plural(unprocessed, "ligne")} en cours de classement automatique (recherche des commerçants dans l&apos;annuaire des entreprises) : recharge la
            page dans un moment.
          </p>
        )}
      </Card>

      {overview.suggestions.length > 0 && (
        <Card>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Catégories proposées</h2>
          <p className="mt-1 text-xs text-n-600">Elles n&apos;existent pas encore et classeraient une partie des lignes à vérifier. Coche celles à créer.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {overview.suggestions.map((s) => (
              <li key={s.name}>
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(s.name)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(s.name);
                        else next.delete(s.name);
                        return next;
                      })
                    }
                  />
                  <IconBadge icon={s.icon} color={s.color} size="sm" />
                  <span className="flex-1">
                    <strong>{s.name}</strong> {s.isIncome && <span className="text-xs text-n-600">(revenu)</span>}
                    <span className="block text-xs text-n-600">
                      {plural(s.count, "ligne")} · ex. {s.examples.join(", ")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button onClick={createCategories} loading={pending} disabled={picked.size === 0}>
              Créer {plural(picked.size, "catégorie")}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Par commerçant</h2>
        {overview.groups.length === 0 ? (
          <Banner tone="success">Rien à vérifier : tout est classé avec assez de confiance.</Banner>
        ) : (
          <ul className="mt-2 divide-y divide-divider">
            {overview.groups.slice(0, shown).map((g) => {
              const current = g.categoryId ? categoryById.get(g.categoryId) : undefined;
              const choice = choiceOf(g);
              const options = categories.filter((c) => g.direction === "in" || !c.isIncome || c.id === g.categoryId);
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" title={g.label}>
                      {g.merchantKey}
                    </p>
                    <p className="truncate text-xs text-n-600">
                      {plural(g.count, "ligne")} · {formatCents(g.totalCents, "always")} · dernière le {shortDate(g.lastDate)}
                    </p>
                    <p className="truncate text-xs text-warn-800">
                      {current ? current.name : "Sans catégorie"} · confiance {g.confidence} % ({g.sourceLabel})
                      {g.suggestedName && ` · irait dans « ${g.suggestedName} »`}
                    </p>
                  </div>
                  <Select
                    value={choice}
                    onChange={(e) => setChoices((prev) => ({ ...prev, [g.id]: e.target.value }))}
                    aria-label={`Catégorie de ${g.merchantKey}`}
                    className="w-48"
                  >
                    <option value="">Choisir…</option>
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  <Button variant={choice && choice !== g.categoryId ? "primary" : "secondary"} onClick={() => validate(g)} disabled={pending || !choice}>
                    Valider
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {overview.groups.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 min-h-11 w-full rounded-card font-semibold text-accent-700 hover:bg-n-100">
            Afficher plus ({overview.groups.length - shown} commerçants)
          </button>
        )}
      </Card>
    </div>
  );
}
