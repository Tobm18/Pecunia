"use client";

import { Sparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { classifyMerchants, createCategoriesFromSuggestions } from "@/lib/data/categorize-actions";
import type { CategoryAnalysis, MerchantGroup } from "@/lib/data/categorize";
import { shortDate } from "@/lib/domain/dates";
import { formatCents, formatPercent } from "@/lib/domain/money";
import type { Category } from "@/lib/domain/types";
import { IconBadge } from "@/components/ui/icons";
import { Banner, Button, Card, Segmented, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

type Filter = "todo" | "all";

const PAGE = 60;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/**
 * Classement par commerçant : chaque groupe réunit les lignes d'un même commerçant ; la catégorie
 * proposée (règles apprises, mémoire, mots-clés) est pré-remplie et se change d'un clic. Appliquer
 * classe toutes les lignes du commerçant et retient le choix pour ses prochaines lignes.
 */
export function ClassifyView({ analysis, categories }: { analysis: CategoryAnalysis; categories: Category[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("todo");
  const [shown, setShown] = useState(PAGE);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(analysis.suggestions.map((s) => s.name)));
  // choix en cours par groupe (pré-rempli avec la proposition)
  const [choices, setChoices] = useState<Record<string, string>>({});
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const autresId = categories.find((c) => c.name.toLowerCase() === "autres")?.id ?? null;

  const groups = analysis.groups.filter((g) => (filter === "todo" ? g.uncategorized > 0 : true));
  const choiceOf = (g: MerchantGroup) => choices[g.id] ?? g.proposedCategoryId ?? "";
  const ready = groups.filter((g) => g.uncategorized > 0 && choiceOf(g) && choiceOf(g) !== autresId && choiceOf(g) !== g.currentCategoryId);
  const readyLines = ready.reduce((n, g) => n + g.uncategorized, 0);
  const share = analysis.total ? analysis.uncategorized / analysis.total : 0;

  function apply(list: MerchantGroup[]) {
    const items = list.map((g) => ({ merchantKey: g.merchantKey, direction: g.direction, categoryId: choiceOf(g) })).filter((i) => i.categoryId);
    if (!items.length) return;
    startTransition(async () => {
      const r = await classifyMerchants(items);
      startTransition(() => toast(r.ok ? `${plural(r.data.changed, "transaction classée", "transactions classées")}` : r.error, r.ok ? "success" : "error"));
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-3xl font-extrabold tabular-nums">{analysis.uncategorized}</p>
            <p className="text-sm text-n-700">
              transaction{analysis.uncategorized > 1 ? "s" : ""} sur {analysis.total} dans « Autres » ou sans catégorie ({formatPercent(share, 0)})
            </p>
          </div>
          {ready.length > 0 && (
            <Button variant="primary" onClick={() => apply(ready)} loading={pending}>
              <Sparkles size={15} /> Appliquer les {ready.length} propositions ({plural(readyLines, "ligne")})
            </Button>
          )}
        </div>
      </Card>

      {analysis.suggestions.length > 0 && (
        <Card>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Catégories proposées</h2>
          <p className="mt-1 text-xs text-n-600">Ces catégories n&apos;existent pas encore et classeraient une partie de tes lignes. Coche celles à créer.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {analysis.suggestions.map((s) => (
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Par commerçant</h2>
          <Segmented
            value={filter}
            onChange={(f) => {
              setFilter(f);
              setShown(PAGE);
            }}
            size="sm"
            options={[
              { value: "todo", label: "À classer" },
              { value: "all", label: "Tous" },
            ]}
          />
        </div>
        {groups.length === 0 ? (
          <Banner tone="success">Tout est classé.</Banner>
        ) : (
          <ul className="mt-2 divide-y divide-divider">
            {groups.slice(0, shown).map((g) => {
              const current = g.currentCategoryId ? categoryById.get(g.currentCategoryId) : undefined;
              const choice = choiceOf(g);
              const options = categories.filter((c) => (g.direction === "out" ? !c.isIncome || c.id === autresId : true));
              return (
                <li key={g.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" title={g.label}>
                      {g.merchantKey}
                    </p>
                    <p className="truncate text-xs text-n-600">
                      {plural(g.count, "ligne")} · {formatCents(g.totalCents, "always")} · dernière le {shortDate(g.lastDate)}
                      {current && ` · actuellement ${current.name}`}
                      {g.uncategorized > 0 && g.uncategorized < g.count && ` (${g.uncategorized} à classer)`}
                      {!g.proposedCategoryId && g.suggestedName && ` · irait dans « ${g.suggestedName} »`}
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
                        {c.id === g.proposedCategoryId ? " (proposée)" : ""}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={() => apply([g])} disabled={pending || !choice || (choice === g.currentCategoryId && g.uncategorized === 0)}>
                    Appliquer
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {groups.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 min-h-11 w-full rounded-card font-semibold text-accent-700 hover:bg-n-100">
            Afficher plus ({groups.length - shown} commerçants)
          </button>
        )}
      </Card>
    </div>
  );
}
