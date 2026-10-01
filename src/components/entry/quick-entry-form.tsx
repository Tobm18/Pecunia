"use client";

import { clsx } from "clsx";
import { ArrowUpDown, Check, CornerDownLeft } from "lucide-react";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { createEntry, type BudgetAlert, type CreatedEntry } from "@/lib/data/actions";
import { longDayMonth, todayIso } from "@/lib/domain/dates";
import { needsNature, type EntryKind, type IncomeNature } from "@/lib/domain/entries";
import { centsToInput, formatCents, formatPercent, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import { findForecastMatch } from "@/lib/domain/forecast";
import { isActiveOn } from "@/lib/domain/recurrences";
import { normalizeText } from "@/lib/domain/csv-import";
import { findPlace, suggestPlaces } from "@/lib/domain/places";
import type { Account, Category, Recurrence } from "@/lib/domain/types";
import { iconFor } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { Banner, Button, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { useAppData } from "@/components/app/app-data";
import { shortAccountName } from "@/lib/domain/accounts";

const KIND_OPTIONS: { value: EntryKind; label: string }[] = [
  { value: "out", label: "− Sortie" },
  { value: "in", label: "+ Entrée" },
  { value: "transfer", label: "⇄ Virement" },
];

function defaultAccount(accounts: Account[]): Account | undefined {
  return accounts.find((a) => a.type === "current") ?? accounts[0];
}

function defaultTarget(accounts: Account[], fromId: string | undefined): Account | undefined {
  return accounts.find((a) => a.id !== fromId && a.type === "savings") ?? accounts.find((a) => a.id !== fromId);
}

/** Catégories proposées : revenus en tête pour une entrée, masqués pour une sortie. */
function categoriesFor(kind: EntryKind, categories: Category[]): Category[] {
  if (kind === "out") return categories.filter((c) => !c.isIncome);
  return [...categories.filter((c) => c.isIncome), ...categories.filter((c) => !c.isIncome)];
}

export function QuickEntryForm({
  variant,
  onDone,
  onCreated,
}: {
  /** sheet = feuille mobile (tuiles, puces) ; page = écran Saisie web (listes déroulantes) */
  variant: "sheet" | "page";
  onDone?: () => void;
  onCreated?: (entry: CreatedEntry & { date: string; categoryName: string | null }) => void;
}) {
  const { activeAccounts, activeCategories, placeMemory, balances, accountById, categoryById, recurrences, forecastItems } = useAppData();
  const toast = useToast();
  const amountRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [kind, setKind] = useState<EntryKind>("out");
  const [amount, setAmount] = useState("");
  const [place, setPlace] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | undefined>(() => defaultAccount(activeAccounts)?.id);
  const [toAccountId, setToAccountId] = useState<string | undefined>(
    () => defaultTarget(activeAccounts, defaultAccount(activeAccounts)?.id)?.id,
  );
  const [nature, setNature] = useState<IncomeNature>("income");
  const [date, setDate] = useState(todayIso);
  const [note, setNote] = useState("");
  const [memoryApplied, setMemoryApplied] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [budgetAlert, setBudgetAlert] = useState<BudgetAlert | null>(null);
  /** Rapprochement : dépense prévue à lier, ou écartée pour cette saisie */
  const [linkedForecastId, setLinkedForecastId] = useState<string | null>(null);
  const [dismissedForecastId, setDismissedForecastId] = useState<string | null>(null);

  const account = accountId ? accountById.get(accountId) : undefined;
  const categories = useMemo(() => categoriesFor(kind, activeCategories), [kind, activeCategories]);
  const suggestions = useMemo(
    () =>
      suggestPlaces(placeMemory, place).filter((m) => accountById.get(m.accountId) && !accountById.get(m.accountId)!.archivedAt),
    [placeMemory, place, accountById],
  );
  const showNature = needsNature(kind, account);
  const isSheet = variant === "sheet";

  // Modèles rapides : récurrences actives (loyer, salaire, abonnements, virements d'épargne)
  const templates = useMemo(() => {
    const today = todayIso();
    return recurrences
      .filter((r) => isActiveOn(r, today) && accountById.get(r.accountId) && !accountById.get(r.accountId)!.archivedAt)
      .slice(0, 10);
  }, [recurrences, accountById]);

  const forecastMatch = useMemo(() => {
    if (kind === "transfer") return null;
    const cents = parseAmountToCents(amount);
    if (cents === null || cents <= 0) return null;
    return findForecastMatch(
      forecastItems.filter((f) => f.id !== dismissedForecastId),
      { place, signedCents: kind === "out" ? -cents : cents, date, accountId },
      normalizeText,
    );
  }, [kind, amount, place, date, accountId, forecastItems, dismissedForecastId]);
  const linked = forecastMatch && linkedForecastId === forecastMatch.id ? forecastMatch : null;

  function applyTemplate(r: Recurrence) {
    setKind(r.type);
    setAmount(centsToInput(r.amountCents));
    setPlace(r.label);
    setCategoryId(r.type === "transfer" ? null : r.categoryId);
    setAccountId(r.accountId);
    if (r.type === "transfer") setToAccountId(r.toAccountId ?? defaultTarget(activeAccounts, r.accountId)?.id);
    setMemoryApplied(false);
    setShowSuggestions(false);
    setError(null);
  }

  function applyMemory(entry: { place: string; categoryId: string | null; accountId: string }) {
    const cat = entry.categoryId ? categoryById.get(entry.categoryId) : undefined;
    const acc = accountById.get(entry.accountId);
    if (cat && !cat.archivedAt) setCategoryId(cat.id);
    if (acc && !acc.archivedAt) setAccountId(acc.id);
    setMemoryApplied(Boolean((cat && !cat.archivedAt) || (acc && !acc.archivedAt)));
  }

  function onPlaceChange(value: string) {
    setPlace(value);
    setShowSuggestions(true);
    setError(null);
    const match = findPlace(placeMemory, value);
    if (match) applyMemory(match);
    else setMemoryApplied(false);
  }

  function pickSuggestion(entry: (typeof suggestions)[number]) {
    setPlace(entry.place);
    applyMemory(entry);
    setShowSuggestions(false);
  }

  function changeKind(next: EntryKind) {
    setKind(next);
    setError(null);
    if (next !== "transfer" && categoryId && !categoriesFor(next, activeCategories).some((c) => c.id === categoryId)) {
      setCategoryId(null);
    }
    if (next === "transfer" && toAccountId === accountId) setToAccountId(defaultTarget(activeAccounts, accountId)?.id);
  }

  function swapAccounts() {
    setAccountId(toAccountId);
    setToAccountId(accountId);
  }

  function resetAfterSubmit() {
    // on garde type, date et compte pour enchaîner (saisie en rafale)
    setAmount("");
    setPlace("");
    setCategoryId(null);
    setNote("");
    setNature("income");
    setMemoryApplied(false);
    setShowSuggestions(false);
    setLinkedForecastId(null);
    setDismissedForecastId(null);
    amountRef.current?.focus();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createEntry({
        kind,
        amount,
        place,
        categoryId: kind === "transfer" ? null : categoryId,
        accountId: accountId ?? null,
        toAccountId: kind === "transfer" ? (toAccountId ?? null) : null,
        nature,
        date,
        note,
      }, linked?.id ?? null).catch(() => ({ ok: false as const, error: "Enregistrement impossible, réessaie dans un instant." }));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast(`${result.data.label} · ${result.data.amount} · ${result.data.accountName}`);
      if (result.data.budgetAlert) setBudgetAlert(result.data.budgetAlert);
      onCreated?.({ ...result.data, date, categoryName: categoryId ? (categoryById.get(categoryId)?.name ?? null) : null });
      resetAfterSubmit();
    });
  }

  const accountPicker = (value: string | undefined, onChange: (id: string) => void, label: string, exclude?: string) =>
    isSheet ? (
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label={label}>
        {activeAccounts
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={value === a.id}
              onClick={() => onChange(a.id)}
              className={clsx(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
                value === a.id ? "border-ink bg-ink text-on-ink" : "border-n-300 bg-surface",
              )}
            >
              <span className="size-2 rounded-full" style={{ backgroundColor: a.color }} />
              {shortAccountName(a)}
            </button>
          ))}
      </div>
    ) : (
      <Select value={value ?? ""} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {activeAccounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} · {formatCents(balances[a.id] ?? 0)}
          </option>
        ))}
      </Select>
    );

  const transferCards = (value: string | undefined, onChange: (id: string) => void, label: string) => (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
      {activeAccounts.map((a) => (
        <button
          key={a.id}
          type="button"
          role="radio"
          aria-checked={value === a.id}
          onClick={() => onChange(a.id)}
          className={clsx(
            "rounded-xl border px-3 py-2.5 text-left",
            value === a.id ? "border-ink bg-ink text-on-ink" : "border-n-300 bg-surface hover:bg-n-100",
          )}
        >
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <span className="size-2 rounded-full" style={{ backgroundColor: a.color }} />
            {shortAccountName(a)}
          </span>
          <span className={clsx("text-xs tabular-nums", value === a.id ? "opacity-75" : "text-n-600")}>
            {formatCents(balances[a.id] ?? 0)}
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {isSheet && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-extrabold">Nouvelle saisie</h2>
            <p className="text-sm text-n-600">Session du {longDayMonth(todayIso())}</p>
          </div>
          <Button onClick={onDone}>Terminer</Button>
        </div>
      )}

      {budgetAlert && (
        <Banner tone="warn" onClose={() => setBudgetAlert(null)}>
          <strong>{budgetAlert.categoryName}</strong> : {formatPercent(budgetAlert.ratio, 0)} du budget
          {budgetAlert.over ? " - dépassé." : ""}
        </Banner>
      )}

      {forecastMatch &&
        (linked ? (
          <Banner
            tone="success"
            action={
              <button type="button" onClick={() => setLinkedForecastId(null)} className="font-bold">
                Annuler
              </button>
            }
          >
            Sera liée à la dépense prévue « {linked.label} » : elle passera à « réalisée ».
          </Banner>
        ) : (
          <Banner
            tone="info"
            action={
              <span className="flex shrink-0 gap-3 font-bold">
                <button type="button" onClick={() => setLinkedForecastId(forecastMatch.id)} className="text-accent-700">
                  Lier
                </button>
                <button type="button" onClick={() => setDismissedForecastId(forecastMatch.id)}>
                  Ignorer
                </button>
              </span>
            }
          >
            Correspond à une dépense prévue : « {forecastMatch.label} » du {longDayMonth(forecastMatch.date)} (
            {formatCents(Math.abs(forecastMatch.amountCents))}).
          </Banner>
        ))}

      <div className={clsx("flex flex-col gap-3", !isSheet && "md:flex-row md:items-end")}>
        <Segmented value={kind} options={KIND_OPTIONS} onChange={changeKind} className={isSheet ? "w-full" : "md:w-auto"} />
        <div className="flex-1">
          {!isSheet && <Label htmlFor="entry-amount">Montant</Label>}
          <div
            className={clsx(
              "flex items-center rounded-card border-2 bg-surface px-4 focus-within:border-accent",
              isSheet ? "border-transparent py-3 shadow-card" : "border-n-300",
            )}
          >
            <input
              id="entry-amount"
              ref={amountRef}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              value={amount}
              onChange={(e) => {
                setAmount(sanitizeAmountInput(e.target.value));
                setError(null);
              }}
              aria-label="Montant"
              className={clsx(
                "w-full bg-transparent font-extrabold tabular-nums placeholder:text-n-400 focus:outline-none",
                isSheet ? "text-[42px] leading-tight" : "min-h-11 text-2xl",
              )}
            />
            <span className={clsx("font-extrabold text-n-500", isSheet ? "text-3xl" : "text-xl")}>€</span>
          </div>
        </div>
      </div>

      {templates.length > 0 && (
        <div>
          {!isSheet && <Label>Modèles</Label>}
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Modèles rapides">
            {templates.map((r) => {
              const cat = r.categoryId ? categoryById.get(r.categoryId) : undefined;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => applyTemplate(r)}
                  className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-n-300 bg-surface px-3.5 text-sm font-semibold hover:bg-n-100 md:min-h-8 md:text-xs"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: r.type === "transfer" ? (accountById.get(r.toAccountId ?? "")?.color ?? "#98a1b0") : (cat?.color ?? "#98a1b0") }}
                  />
                  {r.label} <span className="font-normal text-n-600">· {centsToInput(r.amountCents)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {kind === "transfer" ? (
        <>
          <div>
            <Label>Depuis</Label>
            {transferCards(accountId, setAccountId, "Compte source")}
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapAccounts}
              className="flex size-11 items-center justify-center rounded-xl border border-n-300 bg-surface hover:bg-n-100"
              aria-label="Inverser les comptes"
            >
              <ArrowUpDown size={18} />
            </button>
          </div>
          <div>
            <Label>Vers</Label>
            {transferCards(toAccountId, setToAccountId, "Compte destination")}
          </div>
          <p className="rounded-xl bg-n-100 px-4 py-3 text-sm text-n-700">
            Pas de catégorie - exclu des dépenses, des budgets et du taux d&apos;épargne.
          </p>
          <div>
            <Label htmlFor="entry-label">Libellé (facultatif)</Label>
            <Input
              id="entry-label"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder={`Virement ${toAccountId ? (accountById.get(toAccountId)?.name ?? "") : ""}`}
            />
          </div>
        </>
      ) : (
        <div className={clsx("grid gap-4", !isSheet && "md:grid-cols-4")}>
          <div className="relative">
            <Label htmlFor="entry-place">{kind === "in" ? "Source" : "Lieu"}</Label>
            <Input
              id="entry-place"
              value={place}
              autoComplete="off"
              placeholder={kind === "in" ? "Employeur, remboursement…" : "Carrefour, SNCF…"}
              onChange={(e) => onPlaceChange(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              aria-autocomplete="list"
              aria-expanded={showSuggestions && suggestions.length > 0}
            />
            {showSuggestions && suggestions.length > 0 && (
              <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-n-300 bg-surface shadow-pop" role="listbox">
                {suggestions.map((s) => {
                  const cat = s.categoryId ? categoryById.get(s.categoryId) : undefined;
                  return (
                    <li key={s.place}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickSuggestion(s)}
                        className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-n-100"
                      >
                        <span className="font-semibold">{s.place}</span>
                        <span className="text-xs text-n-600">
                          {[cat?.name, accountById.get(s.accountId)?.name].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {memoryApplied && (
              <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-accent-700">
                <Check size={13} /> Catégorie et compte repris de ta dernière saisie
              </p>
            )}
          </div>

          <div className={clsx(isSheet && "order-none")}>
            <Label htmlFor="entry-category">Catégorie</Label>
            {isSheet ? (
              <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Catégorie">
                {categories.map((c) => {
                  const Icon = iconFor(c.icon);
                  const selected = categoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setCategoryId(c.id);
                        setMemoryApplied(false);
                        setError(null);
                      }}
                      className={clsx(
                        "flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[11px] font-semibold leading-tight",
                        selected ? "border-ink bg-ink text-on-ink" : "border-n-300 bg-surface",
                      )}
                    >
                      <Icon size={18} style={selected ? undefined : { color: c.color }} />
                      <span className="max-w-full truncate">{c.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Select
                id="entry-category"
                value={categoryId ?? ""}
                onChange={(e) => {
                  setCategoryId(e.target.value || null);
                  setMemoryApplied(false);
                }}
              >
                <option value="">Choisir…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label>Compte</Label>
            {accountPicker(
              accountId,
              (id) => {
                setAccountId(id);
                setMemoryApplied(false);
              },
              "Compte",
            )}
          </div>

          {showNature && (
            <div>
              <Label>Nature</Label>
              <Segmented
                value={nature}
                onChange={setNature}
                options={[
                  { value: "interest", label: "Intérêts d'épargne" },
                  { value: "income", label: "Revenu" },
                ]}
                className="w-full"
              />
            </div>
          )}
        </div>
      )}

      <div className={clsx("grid grid-cols-2 gap-3", !isSheet && "md:grid-cols-4")}>
        <div>
          <Label htmlFor="entry-date">Date</Label>
          <Input id="entry-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} required />
        </div>
        <div className={clsx(!isSheet && "md:col-span-1")}>
          <Label htmlFor="entry-note">Note</Label>
          <Input id="entry-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facultatif" />
        </div>
      </div>

      <FieldError>{error}</FieldError>

      <div className={clsx("flex items-center gap-3", isSheet ? "sticky bottom-0 -mx-5 border-t border-divider bg-surface px-5 pt-3" : "border-t border-divider pt-4")}>
        <button
          type="submit"
          disabled={pending}
          className={clsx(
            "flex items-center justify-between gap-3 rounded-[12px] bg-accent font-bold text-white hover:bg-accent-600 disabled:opacity-60",
            isSheet ? "min-h-14 w-full px-5 text-lg" : "min-h-10 px-4 text-sm",
          )}
        >
          <span className="flex items-center gap-2">
            {pending && <Spinner size={isSheet ? 18 : 15} />}
            {pending ? "Enregistrement…" : "Valider et continuer"}
          </span>
          {isSheet ? (
            <span className="text-sm font-medium opacity-75">date conservée</span>
          ) : (
            <CornerDownLeft size={15} className="opacity-75" />
          )}
        </button>
        {!isSheet && <p className="text-xs text-n-600">Le formulaire se vide, la date reste.</p>}
      </div>
    </form>
  );
}
