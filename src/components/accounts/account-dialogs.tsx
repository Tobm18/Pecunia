"use client";

import { clsx } from "clsx";
import { Archive, Pencil, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  adjustBalance,
  createAccount,
  setAccountArchived,
  setAccountInBudget,
  updateAccount,
} from "@/lib/data/actions";
import { ACCOUNT_ICONS, ACCOUNT_TYPE_LABELS, PALETTE } from "@/lib/domain/defaults";
import { todayIso } from "@/lib/domain/dates";
import { adjustmentCents } from "@/lib/domain/entries";
import { centsToInput, formatCents, parseAmountToCents, sanitizeAmountInput } from "@/lib/domain/money";
import type { Account, AccountType } from "@/lib/domain/types";
import { IconBadge } from "@/components/ui/icons";
import { Modal, useToast } from "@/components/ui/overlay";
import { Banner, Button, FieldError, Input, Label, Segmented } from "@/components/ui/primitives";

export function IconColorPicker({
  icon,
  color,
  onIcon,
  onColor,
  icons,
}: {
  icon: string;
  color: string;
  onIcon: (v: string) => void;
  onColor: (v: string) => void;
  icons: readonly string[];
}) {
  return (
    <>
      <div>
        <Label>Icône</Label>
        <div className="flex flex-wrap gap-2">
          {icons.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onIcon(name)}
              aria-pressed={icon === name}
              aria-label={name}
              className={clsx("rounded-xl p-0.5 ring-2", icon === name ? "ring-ink" : "ring-transparent")}
            >
              <IconBadge icon={name} color={color} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Couleur</Label>
        <div className="flex flex-wrap gap-2">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onColor(c)}
              aria-pressed={color === c}
              aria-label={`Couleur ${c}`}
              className={clsx("size-8 rounded-full ring-2 ring-offset-2 ring-offset-surface", color === c ? "ring-ink" : "ring-transparent")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function NewAccountButton() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("savings");
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(todayIso);
  const [icon, setIcon] = useState("bank");
  const [color, setColor] = useState(PALETTE[1]!);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const balanceInvalid = balance.trim() !== "" && parseAmountToCents(balance) === null;

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await createAccount({ name, type, initialBalance: balance, initialBalanceDate: date, color, icon, today: todayIso() });
      if (!result.ok) return setError(result.error);
      toast(`Compte « ${name.trim()} » créé`);
      setOpen(false);
      setName("");
      setBalance("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        + Nouveau compte
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nouveau compte"
        footer={
          <Button variant="primary" onClick={submit} loading={pending} disabled={!name.trim() || balanceInvalid}>
            Créer le compte
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="acc-name">Nom</Label>
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Livret A, Épargne projet…" />
          </div>
          <div>
            <Label>Type</Label>
            <Segmented
              value={type}
              onChange={(t) => {
                setType(t);
                setIcon(t === "savings" ? "bank" : t === "cash" ? "wallet" : "card");
              }}
              className="w-full"
              options={(Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]).map((t) => ({ value: t, label: ACCOUNT_TYPE_LABELS[t] }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="acc-balance">Solde initial</Label>
              <Input
                id="acc-balance"
                inputMode="decimal"
                value={balance}
                placeholder="0,00"
                onChange={(e) => setBalance(sanitizeAmountInput(e.target.value, true))}
                aria-invalid={balanceInvalid}
              />
              <FieldError>{balanceInvalid ? "Montant invalide." : null}</FieldError>
            </div>
            <div>
              <Label htmlFor="acc-date">Au</Label>
              <Input id="acc-date" type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>
          <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} icons={ACCOUNT_ICONS} />
          <FieldError>{error}</FieldError>
        </div>
      </Modal>
    </>
  );
}

export function RestoreAccountButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await setAccountArchived(id, false);
          toast(r.ok ? "Compte restauré" : r.error, r.ok ? "success" : "error");
        })
      }
    >
      Restaurer
    </Button>
  );
}

/** Modale « Ajuster le solde » : crée une ligne Régularisation si l'écart ≥ 0,01 €. */
export function AdjustBalanceButton({ account, balanceCents }: { account: Account; balanceCents: number }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const real = parseAmountToCents(value);
  const diff = real === null ? null : adjustmentCents(balanceCents, real);

  function submit() {
    if (real === null) return;
    startTransition(async () => {
      const result = await adjustBalance(account.id, value, todayIso());
      if (!result.ok) return setError(result.error);
      if (result.data.created) toast("Régularisation créée");
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        onClick={() => {
          setValue(centsToInput(balanceCents));
          setError(null);
          setOpen(true);
        }}
      >
        <SlidersHorizontal size={15} /> Ajuster le solde
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Ajuster le solde - ${account.name}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="primary" onClick={submit} loading={pending} disabled={real === null}>
              {diff === null ? "Valider" : "Créer la régularisation"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl bg-n-100 px-3 py-2.5 text-sm">
            <span className="text-n-700">Solde calculé par Pecunia</span>
            <strong className="tabular-nums">{formatCents(balanceCents)}</strong>
          </div>
          <div>
            <Label htmlFor="adjust-real">Solde réel affiché par ta banque</Label>
            <Input
              id="adjust-real"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(sanitizeAmountInput(e.target.value, true))}
              className="!text-lg font-bold"
            />
          </div>
          {diff !== null && (
            <Banner tone="info">
              Une ligne « Régularisation » de <strong>{formatCents(diff, "always")}</strong> sera créée.
            </Banner>
          )}
          <FieldError>{error}</FieldError>
        </div>
      </Modal>
    </>
  );
}

/** Bloc latéral du détail de compte : budget, modification, archivage. */
export function AccountSettings({ account, balanceCents }: { account: Account; balanceCents: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [name, setName] = useState(account.name);
  const [icon, setIcon] = useState(account.icon);
  const [color, setColor] = useState(account.color);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<"budget" | "edit" | "archive" | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? null);
        toast(r.error ?? "Erreur", "error");
        return;
      }
      toast(success);
      after?.();
    });
  }

  function archive() {
    setAction("archive");
    run(() => setAccountArchived(account.id, true), "Compte archivé", () => {
      setArchiveOpen(false);
      router.push("/comptes");
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-start justify-between gap-3 text-sm">
        <span>
          <span className="block font-semibold">Inclure dans le budget</span>
          <span className="text-xs text-n-600">Ses dépenses comptent dans les budgets</span>
        </span>
        <input
          type="checkbox"
          checked={account.inBudget}
          disabled={pending}
          onChange={(e) => {
            setAction("budget");
            run(() => setAccountInBudget(account.id, e.target.checked), "Préférence enregistrée");
          }}
        />
      </label>
      <div className="grid grid-cols-2 gap-2 border-t border-divider pt-3">
        <Button onClick={() => setEditOpen(true)}>
          <Pencil size={14} /> Modifier
        </Button>
        <Button
          variant="ghost"
          onClick={() => (balanceCents !== 0 ? setArchiveOpen(true) : archive())}
          loading={pending && action === "archive" && !archiveOpen}
          disabled={pending}
        >
          <Archive size={14} /> Archiver
        </Button>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Modifier le compte"
        footer={
          <Button
            variant="primary"
            disabled={!name.trim() || pending}
            loading={pending && action === "edit"}
            onClick={() => {
              setAction("edit");
              run(() => updateAccount(account.id, { name, icon, color }), "Compte modifié", () => setEditOpen(false));
            }}
          >
            Enregistrer
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <Label htmlFor="edit-acc-name">Nom</Label>
            <Input id="edit-acc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <IconColorPicker icon={icon} color={color} onIcon={setIcon} onColor={setColor} icons={ACCOUNT_ICONS} />
          <FieldError>{error}</FieldError>
        </div>
      </Modal>

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Archiver ce compte ?"
        footer={
          <>
            <Button onClick={() => setArchiveOpen(false)}>Annuler</Button>
            <Button variant="danger" onClick={archive} loading={pending && action === "archive"}>
              Archiver quand même
            </Button>
          </>
        }
      >
        <p className="text-sm">
          Ce compte a un solde de <strong>{formatCents(balanceCents)}</strong> - archiver quand même ? Son historique reste
          consultable et intact.
        </p>
      </Modal>
    </div>
  );
}
