"use client";

import { clsx } from "clsx";
import { Check, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { useState, useTransition, type ReactNode } from "react";
import { createForecastItems, decideProposals, deleteForecastItem, resetProposal, updateForecastItem } from "@/lib/data/planning-actions";
import { monthLabel, shortDate } from "@/lib/domain/dates";
import { formatCents, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import { shortAccountName } from "@/lib/domain/accounts";
import { useAppData } from "@/components/app/app-data";
import { Amount } from "@/components/ui/money";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, Card, CardHeader, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";

export interface PlanLine {
  key: string;
  kind: "recurrence" | "budget" | "planned";
  label: string;
  type: "out" | "in" | "transfer";
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  /** Montant retenu, positif */
  amountCents: number;
  proposedCents: number;
  date: string | null;
  proposedDate: string | null;
  /** Montant signé vu depuis les comptes affichés (0 : virement entre deux comptes affichés) */
  viewCents: number;
  status: "pending" | "accepted" | "rejected" | "planned";
  modified: boolean;
  /** Décision enregistrée (sinon : statut par défaut, récurrence acceptée ou budget à valider) */
  decided: boolean;
  itemId: string | null;
  seriesId: string | null;
}

interface Props {
  month: string;
  period: { start: string; end: string };
  today: string;
  lines: PlanLine[];
  realized: { key: string; label: string; date: string; cents: number; transfer: boolean }[];
  summary: { startCents: number; inCents: number; outCents: number; endCents: number; endIfAllCents: number };
  defaultAccountId: string | null;
  multiAccount: boolean;
}

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Détail d'un mois du prévisionnel : propositions à valider, lignes retenues, refusées, réalisées. */
export function MonthPlanner({ month, period, today, lines, realized, summary, defaultAccountId, multiAccount }: Props) {
  const { accountById, categoryById } = useAppData();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlanLine | null>(null);
  const [planned, setPlanned] = useState<{ line: PlanLine | null } | null>(null);
  const [modalKey, setModalKey] = useState(0);

  const toValidate = lines.filter((l) => l.status === "pending");
  const retained = lines.filter((l) => l.status === "accepted" || l.status === "planned");
  const rejected = lines.filter((l) => l.status === "rejected");

  function run(key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) {
    setBusy(key);
    startTransition(async () => {
      const r = await action();
      setBusy(null);
      if (!r.ok) toast(r.error, "error");
      else if (success) toast(success);
    });
  }

  const decide = (l: PlanLine, status: "accepted" | "rejected") =>
    run(`${l.key}:${status}`, () => decideProposals([{ sourceKey: l.key, month, status }]));
  // Sélection (lignes à valider uniquement ; les lignes traitées en sortent d'elles-mêmes)
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const selection = toValidate.filter((l) => checked.has(l.key));
  const allChecked = toValidate.length > 0 && selection.length === toValidate.length;
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(toValidate.map((l) => l.key)));
  const plural = (n: number, word: string) => `${n} ligne${n > 1 ? "s" : ""} ${word}${n > 1 ? "s" : ""}`;
  const decideMany = (targets: PlanLine[], status: "accepted" | "rejected", busyKey: string) =>
    run(
      busyKey,
      async () => {
        const r = await decideProposals(targets.map((l) => ({ sourceKey: l.key, month, status })));
        if (r.ok) setChecked(new Set());
        return r;
      },
      plural(targets.length, status === "accepted" ? "acceptée" : "refusée"),
    );
  const acceptAll = () => decideMany(toValidate, "accepted", "all");
  const reset = (l: PlanLine) => run(`${l.key}:reset`, () => resetProposal(l.key));
  const isBusy = (key: string) => pending && busy === key;

  function meta(l: PlanLine): string {
    const parts: string[] = [];
    if (l.date) parts.push(shortDate(l.date));
    if (l.kind === "budget") parts.push("Budget");
    else if (l.kind === "recurrence") parts.push(l.type === "transfer" ? "Virement récurrent" : "Récurrence");
    else parts.push(l.seriesId ? "Prévue · série" : "Prévue");
    if (l.type === "transfer") {
      const from = accountById.get(l.accountId);
      const to = l.toAccountId ? accountById.get(l.toAccountId) : null;
      parts.push(`${from ? shortAccountName(from) : "?"} → ${to ? shortAccountName(to) : "?"}`);
    } else {
      if (l.categoryId && l.kind === "recurrence") parts.push(categoryById.get(l.categoryId)?.name ?? "");
      if (multiAccount) {
        const a = accountById.get(l.accountId);
        if (a) parts.push(shortAccountName(a));
      }
    }
    if (l.modified) parts.push(`modifié (proposé : ${formatCents(l.proposedCents)})`);
    return parts.filter(Boolean).join(" · ");
  }

  const amountOf = (l: PlanLine) =>
    l.type === "transfer" && l.viewCents === 0 ? <Amount cents={l.amountCents} neutral /> : <Amount cents={l.viewCents} type={l.type} />;

  function openEdit(l: PlanLine) {
    setModalKey((k) => k + 1);
    if (l.kind === "planned") setPlanned({ line: l });
    else setEditing(l);
  }
  function openCreate() {
    setModalKey((k) => k + 1);
    setPlanned({ line: null });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card>
          <CardHeader
            title={`À valider · ${monthLabel(month)}`}
            action={
              selection.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button onClick={() => decideMany(selection, "rejected", "sel:rejected")} loading={isBusy("sel:rejected")} className="!text-danger-700">
                    <X size={15} /> Refuser ({selection.length})
                  </Button>
                  <Button variant="primary" onClick={() => decideMany(selection, "accepted", "sel:accepted")} loading={isBusy("sel:accepted")}>
                    <Check size={15} /> Accepter ({selection.length})
                  </Button>
                </div>
              ) : toValidate.length > 1 ? (
                <Button onClick={acceptAll} loading={isBusy("all")}>
                  <Check size={15} /> Tout accepter
                </Button>
              ) : undefined
            }
          />
          {toValidate.length > 1 && (
            <label className="flex min-h-9 cursor-pointer items-center gap-3 border-b border-divider pb-2 text-xs font-semibold text-n-700">
              <input
                type="checkbox"
                className="size-4 accent-[var(--accent)]"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = selection.length > 0 && !allChecked;
                }}
                onChange={toggleAll}
              />
              {selection.length > 0 ? `${selection.length} sélectionnée${selection.length > 1 ? "s" : ""} sur ${toValidate.length}` : "Tout sélectionner"}
            </label>
          )}
          {toValidate.length === 0 ? (
            <p className="text-sm text-n-600">
              Rien à valider ce mois-ci. Tes budgets sont proposés ici ; les échéances de tes récurrences sont retenues d&apos;office.
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {toValidate.map((l) => (
                <Line
                  key={l.key}
                  label={l.label}
                  meta={meta(l)}
                  amount={amountOf(l)}
                  leading={
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
                      checked={checked.has(l.key)}
                      onChange={() => toggle(l.key)}
                      aria-label={`Sélectionner ${l.label}`}
                    />
                  }
                >
                  <IconButton label={`Accepter ${l.label}`} onClick={() => decide(l, "accepted")} loading={isBusy(`${l.key}:accepted`)} tone="accept">
                    <Check size={16} />
                  </IconButton>
                  <IconButton label={`Refuser ${l.label}`} onClick={() => decide(l, "rejected")} loading={isBusy(`${l.key}:rejected`)} tone="reject">
                    <X size={16} />
                  </IconButton>
                  <IconButton label={`Modifier ${l.label}`} onClick={() => openEdit(l)}>
                    <Pencil size={15} />
                  </IconButton>
                </Line>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Retenu pour le mois"
            action={
              <Button onClick={openCreate}>
                <Plus size={15} /> Ajouter
              </Button>
            }
          />
          {retained.length === 0 ? (
            <p className="text-sm text-n-600">
              Accepte des budgets ou ajoute une entrée / sortie prévue, pour ce mois seulement ou pour plusieurs mois.
            </p>
          ) : (
            <ul className="divide-y divide-divider">
              {retained.map((l) => (
                <Line key={l.key} label={l.label} meta={meta(l)} amount={amountOf(l)}>
                  <IconButton label={`Modifier ${l.label}`} onClick={() => openEdit(l)}>
                    <Pencil size={15} />
                  </IconButton>
                  {l.kind === "recurrence" && (
                    <IconButton label={`Refuser ${l.label}`} onClick={() => decide(l, "rejected")} loading={isBusy(`${l.key}:rejected`)} tone="reject">
                      <X size={16} />
                    </IconButton>
                  )}
                  {l.kind === "recurrence" && l.decided && (
                    <IconButton label={`Revenir aux valeurs de ${l.label}`} onClick={() => reset(l)} loading={isBusy(`${l.key}:reset`)}>
                      <RotateCcw size={15} />
                    </IconButton>
                  )}
                  {l.kind === "budget" && (
                    <IconButton label={`Remettre ${l.label} à valider`} onClick={() => reset(l)} loading={isBusy(`${l.key}:reset`)}>
                      <RotateCcw size={15} />
                    </IconButton>
                  )}
                </Line>
              ))}
            </ul>
          )}
        </Card>

        {rejected.length > 0 && (
          <Card>
            <CardHeader title="Refusé" />
            <ul className="divide-y divide-divider opacity-70">
              {rejected.map((l) => (
                <Line key={l.key} label={<span className="line-through">{l.label}</span>} meta={meta(l)} amount={amountOf(l)}>
                  <IconButton label={`Rétablir ${l.label}`} onClick={() => reset(l)} loading={isBusy(`${l.key}:reset`)}>
                    <RotateCcw size={15} />
                  </IconButton>
                </Line>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="order-first flex min-w-0 flex-col gap-4 lg:order-none">
        <Card>
          <CardHeader title="Bilan du mois" />
          <dl className="flex flex-col gap-2 text-sm">
            <SummaryRow label="Solde de début">{formatCents(summary.startCents)}</SummaryRow>
            <SummaryRow label="Entrées retenues">
              <Amount cents={summary.inCents} />
            </SummaryRow>
            <SummaryRow label="Sorties retenues">
              <Amount cents={-summary.outCents} />
            </SummaryRow>
            <div className="mt-1 border-t border-divider pt-2">
              <SummaryRow label={<strong>Solde de fin projeté</strong>}>
                <span className={clsx("text-lg font-extrabold tabular-nums", summary.endCents < 0 && "text-danger-700")}>
                  {formatCents(summary.endCents)}
                </span>
              </SummaryRow>
            </div>
            {toValidate.length > 0 && summary.endIfAllCents !== summary.endCents && (
              <p className="text-xs text-n-600">
                Si tout était accepté : <span className={clsx("font-semibold tabular-nums", summary.endIfAllCents < 0 && "text-danger-700")}>{formatCents(summary.endIfAllCents)}</span>
              </p>
            )}
          </dl>
        </Card>

        {realized.length > 0 && (
          <Card>
            <CardHeader title="Déjà réalisé" />
            <ul className="flex flex-col gap-1.5 text-sm">
              {realized.map((r) => (
                <li key={r.key} className="flex items-center justify-between gap-2 text-n-700">
                  <span className="min-w-0 truncate">
                    <Check size={13} className="mr-1 inline text-accent-700" />
                    {r.label} <span className="text-[11px] text-n-600">· {shortDate(r.date)}</span>
                  </span>
                  <Amount cents={r.cents} neutral={r.transfer && r.cents === 0} className="text-xs" />
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-n-600">Déjà dans le solde actuel.</p>
          </Card>
        )}
      </div>

      {editing && (
        <ProposalModal key={modalKey} line={editing} month={month} period={period} onClose={() => setEditing(null)} />
      )}
      {planned && (
        <PlannedModal
          key={modalKey}
          line={planned.line}
          period={period}
          today={today}
          defaultAccountId={defaultAccountId}
          onClose={() => setPlanned(null)}
        />
      )}
    </div>
  );
}

function Line({
  label,
  meta,
  amount,
  leading,
  children,
}: {
  label: ReactNode;
  meta: string;
  amount: ReactNode;
  leading?: ReactNode;
  children: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{label}</p>
        <p className="text-xs text-n-600 md:truncate">{meta}</p>
      </div>
      <span className="text-sm">{amount}</span>
      <div className="flex min-w-[116px] shrink-0 justify-end gap-1">{children}</div>
    </li>
  );
}

function IconButton({
  label,
  onClick,
  loading,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  loading?: boolean;
  tone?: "accept" | "reject";
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      loading={loading}
      aria-label={label}
      title={label}
      className={clsx(
        "!min-h-9 !px-2",
        tone === "accept" && "!text-accent-700 hover:!bg-accent-100",
        tone === "reject" && "!text-danger-700 hover:!bg-danger-100",
        !tone && "!text-n-700 hover:!bg-n-100",
      )}
    >
      {!loading && children}
    </Button>
  );
}

function SummaryRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-n-700">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

/** Modifier une proposition : montant, date (récurrence), compte (hors virement). Valider l'accepte. */
function ProposalModal({
  line,
  month,
  period,
  onClose,
}: {
  line: PlanLine;
  month: string;
  period: { start: string; end: string };
  onClose: () => void;
}) {
  const { activeAccounts } = useAppData();
  const [amount, setAmount] = useState(centsToInput(line.amountCents));
  const [date, setDate] = useState(line.date ?? "");
  const [accountId, setAccountId] = useState(line.accountId);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cents = parseAmountToCents(amount);

  function submit() {
    setError(null);
    startTransition(async () => {
      // seules les valeurs différentes de la proposition sont enregistrées
      const r = await decideProposals([
        {
          sourceKey: line.key,
          month,
          status: "accepted",
          amount: cents !== null && cents !== line.proposedCents ? amount : null,
          date: line.kind === "recurrence" && date && date !== line.proposedDate ? date : null,
          accountId: line.type !== "transfer" && accountId !== line.accountId ? accountId : null,
        },
      ]);
      if (!r.ok) return setError(r.error);
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Modifier · ${line.label}`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" onClick={submit} loading={pending} disabled={cents === null || cents <= 0}>
            Accepter avec ces valeurs
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-n-700">
          Proposé : {formatCents(line.proposedCents)}
          {line.proposedDate && ` le ${shortDate(line.proposedDate)}`}. La modification ne vaut que pour {monthLabel(month).toLowerCase()}.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pr-amount">Montant</Label>
            <Input id="pr-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))} />
          </div>
          {line.kind === "recurrence" && (
            <div>
              <Label htmlFor="pr-date">Date</Label>
              <Input id="pr-date" type="date" min={period.start} max={period.end} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          )}
        </div>
        {line.type !== "transfer" && (
          <div>
            <Label htmlFor="pr-account">Compte</Label>
            <Select id="pr-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <FieldError>{error}</FieldError>
      </div>
    </Modal>
  );
}

/** Créer (pour 1 à 36 mois) ou modifier une entrée / sortie prévue. */
function PlannedModal({
  line,
  period,
  today,
  defaultAccountId,
  onClose,
}: {
  line: PlanLine | null;
  period: { start: string; end: string };
  today: string;
  defaultAccountId: string | null;
  onClose: () => void;
}) {
  const { activeAccounts } = useAppData();
  const toast = useToast();
  const [direction, setDirection] = useState<"out" | "in" | "transfer">(line?.type ?? "out");
  const [label, setLabel] = useState(line?.label ?? "");
  const [amount, setAmount] = useState(line ? centsToInput(line.amountCents) : "");
  const [date, setDate] = useState(line?.date ?? (today >= period.start && today <= period.end ? today : period.start));
  const [months, setMonths] = useState("1");
  const [accountId, setAccountId] = useState(
    line?.accountId ?? defaultAccountId ?? activeAccounts.find((a) => a.type === "current")?.id ?? activeAccounts[0]?.id ?? "",
  );
  const [toAccountId, setToAccountId] = useState(
    line?.toAccountId ?? activeAccounts.find((a) => a.id !== accountId && a.type === "savings")?.id ?? activeAccounts.find((a) => a.id !== accountId)?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cents = parseAmountToCents(amount);
  const count = Number(months);
  const transfer = direction === "transfer";
  const valid =
    (label.trim() !== "" || transfer) &&
    (!transfer || (toAccountId !== "" && toAccountId !== accountId)) &&
    cents !== null && cents > 0 && date !== "" && Number.isInteger(count) && count >= 1 && count <= 36;

  function act(key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setError(null);
    setBusy(key);
    startTransition(async () => {
      const r = await action();
      setBusy(null);
      if (!r.ok) return setError(r.error);
      toast(success);
      onClose();
    });
  }

  const defaultLabel = () => {
    const to = activeAccounts.find((a) => a.id === toAccountId);
    return to ? `Virement vers ${to.name}` : "Virement";
  };
  const input = { label: transfer && !label.trim() ? defaultLabel() : label, amount, direction, date, accountId, toAccountId: transfer ? toAccountId : null, today };
  const save = () =>
    line?.itemId
      ? act("save", () => updateForecastItem(line.itemId!, input), "Ligne prévue modifiée")
      : act("save", () => createForecastItems({ ...input, months: count }), count > 1 ? `Ajoutée sur ${count} mois` : "Ligne prévue ajoutée");

  return (
    <Modal
      open
      onClose={onClose}
      title={line ? "Modifier la ligne prévue" : "Ajouter une entrée, une sortie ou un virement prévu"}
      footer={
        <>
          {line?.itemId && (
            <div className="mr-auto flex gap-2">
              <Button variant="ghost" className="!text-danger-700" onClick={() => act("del", () => deleteForecastItem(line.itemId!), "Ligne supprimée")} loading={pending && busy === "del"}>
                Supprimer
              </Button>
              {line.seriesId && (
                <Button
                  variant="ghost"
                  className="!text-danger-700"
                  onClick={() => act("series", () => deleteForecastItem(line.itemId!, true), "Série supprimée à partir de ce mois")}
                  loading={pending && busy === "series"}
                >
                  Supprimer la série
                </Button>
              )}
            </div>
          )}
          <Button variant="primary" onClick={save} loading={pending && busy === "save"} disabled={!valid}>
            {line ? "Enregistrer" : "Ajouter"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          value={direction}
          onChange={setDirection}
          className="w-full"
          options={[
            { value: "out", label: "− Sortie" },
            { value: "in", label: "+ Entrée" },
            { value: "transfer", label: "⇄ Virement" },
          ]}
        />
        <div>
          <Label htmlFor="pl-label">Libellé{transfer && " (facultatif)"}</Label>
          <Input
            id="pl-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={transfer ? defaultLabel() : "Assurance auto, prime, vacances…"}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pl-amount">Montant</Label>
            <Input id="pl-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))} placeholder="0,00" />
          </div>
          <div>
            <Label htmlFor="pl-date">{line ? "Date" : "Date (1er mois)"}</Label>
            <Input id="pl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className={clsx("grid gap-3", (!line || transfer) && "grid-cols-2")}>
          <div>
            <Label htmlFor="pl-account">{transfer ? "Depuis" : "Compte"}</Label>
            <Select
              id="pl-account"
              value={accountId}
              onChange={(e) => {
                const next = e.target.value;
                setAccountId(next);
                if (next === toAccountId) setToAccountId(activeAccounts.find((a) => a.id !== next)?.id ?? "");
              }}
            >
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          {transfer && (
            <div>
              <Label htmlFor="pl-to">Vers</Label>
              <Select id="pl-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                {activeAccounts
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </div>
          )}
          {!line && (
            <div>
              <Label htmlFor="pl-months">Pendant</Label>
              <Select id="pl-months" value={months} onChange={(e) => setMonths(e.target.value)}>
                {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "ce mois seulement" : `${n} mois`}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </div>
        {!line && count > 1 && (
          <p className="text-xs text-n-600">
            Une ligne par mois, au même jour, pendant {count} mois. Chaque mois reste modifiable ou supprimable séparément.
          </p>
        )}
        {line?.seriesId && <p className="text-xs text-n-600">Cette ligne fait partie d&apos;une série : la modification ne concerne que ce mois.</p>}
        <FieldError>{error}</FieldError>
      </div>
    </Modal>
  );
}
