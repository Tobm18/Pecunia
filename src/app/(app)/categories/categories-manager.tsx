"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, useTransition } from "react";
import { createCategory, moveCategory, setCategoryArchived, updateCategory } from "@/lib/data/actions";
import { CATEGORY_ICONS, PALETTE } from "@/lib/domain/defaults";
import { formatCents } from "@/lib/domain/money";
import type { Category } from "@/lib/domain/types";
import { useAppData } from "@/components/app/app-data";
import { IconColorPicker } from "@/components/accounts/account-dialogs";
import { IconBadge } from "@/components/ui/icons";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, Card, FieldError, Input, Label } from "@/components/ui/primitives";

interface Draft {
  id: string | null;
  name: string;
  color: string;
  icon: string;
  isIncome: boolean;
  restrictedAccountIds: string[];
}

const emptyDraft = (): Draft => ({ id: null, name: "", color: PALETTE[4]!, icon: "cart", isIncome: false, restrictedAccountIds: [] });

export function CategoriesManager({
  categories,
  budgetByCategory,
}: {
  categories: Category[];
  budgetByCategory: Record<string, number>;
}) {
  const { activeAccounts } = useAppData();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<string | null>(null);
  const active = categories.filter((c) => !c.archivedAt);
  const archived = categories.filter((c) => c.archivedAt);

  function run(task: () => Promise<{ ok: boolean; error?: string }>, success?: string, after?: () => void, name: string | null = null) {
    setError(null);
    setAction(name);
    startTransition(async () => {
      const r = await task();
      if (!r.ok) {
        setError(r.error ?? null);
        if (!draft) toast(r.error ?? "Erreur", "error");
        return;
      }
      if (success) toast(success);
      after?.();
    });
  }

  function save() {
    if (!draft) return;
    const input = {
      name: draft.name,
      color: draft.color,
      icon: draft.icon,
      isIncome: draft.isIncome,
      restrictedAccountIds: draft.restrictedAccountIds,
    };
    run(
      () => (draft.id ? updateCategory(draft.id, input) : createCategory(input)),
      draft.id ? "Catégorie modifiée" : "Catégorie créée",
      () => setDraft(null),
      "save",
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => (setError(null), setDraft(emptyDraft()))}>
          + Nouvelle catégorie
        </Button>
      </div>
      <Card className="!p-0">
        <ul className="divide-y divide-divider">
          {active.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1 pr-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setDraft({ id: c.id, name: c.name, color: c.color, icon: c.icon, isIncome: c.isIncome, restrictedAccountIds: c.restrictedAccountIds });
                }}
                className="flex min-h-14 flex-1 items-center gap-3 px-4 text-left hover:bg-n-100"
              >
                <IconBadge icon={c.icon} color={c.color} />
                <span className="flex-1 font-bold">{c.name}</span>
                <span className="text-sm text-n-600 tabular-nums">
                  {c.isIncome ? "Entrée" : budgetByCategory[c.id] !== undefined ? formatCents(budgetByCategory[c.id]!) : "-"}
                </span>
              </button>
              <button
                type="button"
                disabled={i === 0 || pending}
                onClick={() => run(() => moveCategory(c.id, "up"))}
                className="flex size-10 items-center justify-center rounded-lg text-n-600 hover:bg-n-100 disabled:opacity-30"
                aria-label={`Monter ${c.name}`}
              >
                <ChevronUp size={18} />
              </button>
              <button
                type="button"
                disabled={i === active.length - 1 || pending}
                onClick={() => run(() => moveCategory(c.id, "down"))}
                className="flex size-10 items-center justify-center rounded-lg text-n-600 hover:bg-n-100 disabled:opacity-30"
                aria-label={`Descendre ${c.name}`}
              >
                <ChevronDown size={18} />
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <p className="px-1 text-xs text-n-600">L&apos;ordre choisi ici est celui de tous les sélecteurs de l&apos;application.</p>

      {archived.length > 0 && (
        <Card>
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-n-600">Archivées</h2>
          <ul className="divide-y divide-divider">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2 opacity-70">
                <IconBadge icon={c.icon} color={c.color} size="sm" />
                <span className="flex-1 text-sm font-semibold">{c.name}</span>
                <Button
                  variant="ghost"
                  disabled={pending}
                  loading={pending && action === `restore-${c.id}`}
                  onClick={() => run(() => setCategoryArchived(c.id, false), "Catégorie restaurée", undefined, `restore-${c.id}`)}
                >
                  Restaurer
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? "Modifier la catégorie" : "Nouvelle catégorie"}
        footer={
          draft && (
            <>
              {draft.id && (
                <Button
                  onClick={() => run(() => setCategoryArchived(draft.id!, true), "Catégorie archivée", () => setDraft(null), "archive")}
                  loading={pending && action === "archive"}
                  disabled={pending}
                  className="mr-auto"
                >
                  Archiver
                </Button>
              )}
              <Button variant="primary" onClick={save} loading={pending && action === "save"} disabled={!draft.name.trim() || pending}>
                Enregistrer
              </Button>
            </>
          )
        }
      >
        {draft && (
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="cat-name">Nom</Label>
              <Input id="cat-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={draft.isIncome} onChange={(e) => setDraft({ ...draft, isIncome: e.target.checked })} />
              Catégorie de revenu (salaire…)
            </label>
            <IconColorPicker
              icon={draft.icon}
              color={draft.color}
              onIcon={(icon) => setDraft({ ...draft, icon })}
              onColor={(color) => setDraft({ ...draft, color })}
              icons={CATEGORY_ICONS}
            />
            {!draft.isIncome && (
              <fieldset>
                <legend className="mb-1.5 text-[13px] text-n-700">Comptes concernés par le budget</legend>
                <p className="mb-2 text-xs text-n-600">Aucun coché = tous les comptes « dans le budget ».</p>
                <div className="flex flex-col gap-1.5">
                  {activeAccounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={draft.restrictedAccountIds.includes(a.id)}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            restrictedAccountIds: e.target.checked
                              ? [...draft.restrictedAccountIds, a.id]
                              : draft.restrictedAccountIds.filter((id) => id !== a.id),
                          })
                        }
                      />
                      {a.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <FieldError>{error}</FieldError>
          </div>
        )}
      </Modal>
    </div>
  );
}
