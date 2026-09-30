"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { createForecastItem, deleteForecastItem } from "@/lib/data/planning-actions";
import { numericDate, todayIso } from "@/lib/domain/dates";
import { parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import type { ForecastItem } from "@/lib/domain/types";
import { useAppData } from "@/components/app/app-data";
import { Amount } from "@/components/ui/money";
import { Modal, useToast } from "@/components/ui/overlay";
import { Button, Card, CardHeader, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";

/** Dépenses / revenus ponctuels prévus : liste + ajout. */
export function PlannedItems({ items, defaultAccountId }: { items: ForecastItem[]; defaultAccountId: string | null }) {
  const { activeAccounts, accountById } = useAppData();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [date, setDate] = useState("");
  const [accountId, setAccountId] = useState(defaultAccountId ?? activeAccounts.find((a) => a.type === "current")?.id ?? activeAccounts[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cents = parseAmountToCents(amount);

  function submit() {
    setError(null);
    setBusy("create");
    startTransition(async () => {
      const r = await createForecastItem({ label, amount, direction, date, accountId, today: todayIso() });
      setBusy(null);
      if (!r.ok) return setError(r.error);
      toast("Dépense prévue ajoutée");
      setOpen(false);
      setLabel("");
      setAmount("");
      setDate("");
    });
  }

  function remove(id: string) {
    setBusy(id);
    startTransition(async () => {
      const r = await deleteForecastItem(id);
      setBusy(null);
      if (!r.ok) toast(r.error, "error");
    });
  }

  return (
    <Card>
      <CardHeader
        title="Dépenses et revenus prévus"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={15} /> Ajouter une dépense prévue
          </Button>
        }
      />
      {items.length === 0 ? (
        <p className="text-sm text-n-600">
          Aucune dépense ponctuelle prévue (assurance annuelle, vacances, impôts…). Une fois saisie pour de vrai, elle pourra être liée
          depuis l&apos;écran Saisie pour ne pas être comptée deux fois.
        </p>
      ) : (
        <ul className="divide-y divide-divider">
          {items.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{f.label}</p>
                <p className="text-xs text-n-600">
                  {numericDate(f.date)} · {accountById.get(f.accountId)?.name}
                </p>
              </div>
              <Amount cents={f.amountCents} />
              <Button variant="ghost" onClick={() => remove(f.id)} loading={pending && busy === f.id} aria-label={`Supprimer ${f.label}`}>
                {!(pending && busy === f.id) && <Trash2 size={15} />}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ajouter une dépense prévue"
        footer={
          <Button variant="primary" onClick={submit} loading={pending && busy === "create"} disabled={!label.trim() || cents === null || cents <= 0 || !date}>
            Ajouter
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <Segmented
            value={direction}
            onChange={setDirection}
            className="w-full"
            options={[
              { value: "out", label: "− Dépense" },
              { value: "in", label: "+ Revenu" },
            ]}
          />
          <div>
            <Label htmlFor="fc-label">Libellé</Label>
            <Input id="fc-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Assurance auto, vacances…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fc-amount">Montant</Label>
              <Input id="fc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))} placeholder="0,00" />
            </div>
            <div>
              <Label htmlFor="fc-date">Date</Label>
              <Input id="fc-date" type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="fc-account">Compte</Label>
            <Select id="fc-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <FieldError>{error}</FieldError>
        </div>
      </Modal>
    </Card>
  );
}
