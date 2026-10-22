"use client";

import { Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { addInterest, saveInternalAccount } from "@/lib/data/bank-actions";
import type { BankOverview } from "@/lib/data/bank";
import { shortDate, todayIso } from "@/lib/domain/dates";
import { centsToInput, formatCents, sanitizeAmountInput } from "@/lib/domain/money";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";

type PecuniaAccount = BankOverview["accounts"][number];

const DATALIST_ID = "bank-counterparties";

/** Date proposée pour les intérêts : le 31 décembre de l'année écoulée (ou de l'année, en décembre). */
function interestDate(): string {
  const today = todayIso();
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 12 ? `${y}-12-31` : `${y - 1}-12-31`;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

/** Réglages d'un compte interne : identifiant reconnu dans les virements et solde réel connu. */
function InternalAccountForm({ account }: { account: PecuniaAccount }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [identifier, setIdentifier] = useState(account.identifier ?? "");
  const [keyword, setKeyword] = useState(account.keyword ?? "");
  const [keywordIn, setKeywordIn] = useState(account.keywordIn ?? "");
  const [balance, setBalance] = useState(account.referenceBalanceCents === null ? "" : centsToInput(account.referenceBalanceCents));
  const [date, setDate] = useState(account.referenceBalanceDate ?? todayIso());

  function save() {
    startTransition(async () => {
      const r = await saveInternalAccount({ accountId: account.id, identifier, keyword, keywordIn, balance, balanceDate: balance ? date : "" });
      startTransition(() =>
        toast(r.ok ? (r.data.converted ? `${plural(r.data.converted, "virement")} reconnu${r.data.converted > 1 ? "s" : ""}` : "Compte enregistré") : r.error, r.ok ? "success" : "error"),
      );
    });
  }

  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold">{account.name}</p>
        <p className="text-sm tabular-nums text-n-700">{formatCents(account.balanceCents)}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`kw-${account.id}`}>Virements envoyés vers ce compte</Label>
          <Input id={`kw-${account.id}`} value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Livret A" autoComplete="off" />
          <p className="mt-1 text-[11px] text-n-600">Mot du libellé côté compte courant (débit)</p>
        </div>
        <div>
          <Label htmlFor={`kwin-${account.id}`}>Virements reçus depuis ce compte</Label>
          <Input
            id={`kwin-${account.id}`}
            value={keywordIn}
            onChange={(e) => setKeywordIn(e.target.value)}
            placeholder="vers Compte Du Personnel"
            autoComplete="off"
          />
          <p className="mt-1 text-[11px] text-n-600">Mot du libellé côté compte courant (crédit)</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <div>
          <Label htmlFor={`ident-${account.id}`}>ou IBAN / n° de compte</Label>
          <Input
            id={`ident-${account.id}`}
            list={DATALIST_ID}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="FR76… ou 12345678901"
            autoComplete="off"
            className="font-mono"
          />
        </div>
        <div>
          <Label htmlFor={`bal-${account.id}`}>Solde réel</Label>
          <Input
            id={`bal-${account.id}`}
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(sanitizeAmountInput(e.target.value))}
            placeholder="0,00"
            className="text-right tabular-nums"
          />
        </div>
        <div>
          <Label htmlFor={`date-${account.id}`}>Au</Label>
          <Input id={`date-${account.id}`} type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} disabled={!balance} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={save} loading={pending}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

/** Saisie des intérêts d'un compte épargne (versés directement sur le livret). */
function InterestForm({ account }: { account: PecuniaAccount }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(interestDate);

  function save() {
    startTransition(async () => {
      const r = await addInterest({ accountId: account.id, amount, date });
      startTransition(() => {
        toast(r.ok ? `Intérêts ajoutés sur ${account.name}` : r.error, r.ok ? "success" : "error");
        if (r.ok) setAmount("");
      });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 py-3">
      <p className="min-w-32 flex-1 font-semibold">{account.name}</p>
      <div className="w-28">
        <Label htmlFor={`int-${account.id}`}>Montant</Label>
        <Input
          id={`int-${account.id}`}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
          placeholder="0,00"
          className="text-right tabular-nums"
        />
      </div>
      <div className="w-40">
        <Label htmlFor={`intd-${account.id}`}>Date</Label>
        <Input id={`intd-${account.id}`} type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Button onClick={save} loading={pending} disabled={!amount}>
        Ajouter
      </Button>
    </div>
  );
}

/**
 * Comptes internes (livrets…) : alimentés uniquement par des virements depuis et vers le compte
 * synchronisé, ils sont tenus à jour par la synchronisation. Seuls les intérêts se saisissent à la main.
 */
export function InternalAccounts({ overview }: { overview: BankOverview }) {
  const toast = useToast();
  const syncedIds = new Set((overview.connection?.accounts ?? []).map((b) => b.accountId).filter(Boolean));
  const internal = overview.accounts.filter((a) => !a.archived && !syncedIds.has(a.id));
  const savings = internal.filter((a) => a.type === "savings");

  return (
    <>
      <Card className="lg:col-span-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Comptes suivis par les virements</h2>
        <p className="mt-1 text-xs text-n-600">
          Une ligne du compte synchronisé dont le libellé contient le mot-clé (ou dont le compte en face, créditeur ou donneur d&apos;ordre, est celui-ci) devient un
          virement entre les deux comptes Pecunia. Un virement reçu d&apos;un livret nomme la destination (« Vir. vers Compte Du Personnel ») : renseigne-le dans
          « reçus ». Le solde réel sert de point de départ : il reste juste même quand l&apos;historique se complète.
        </p>
        {internal.length === 0 ? (
          <p className="py-3 text-sm text-n-600">Crée d&apos;abord un compte (bouton « + Nouveau compte » ci-dessus), par exemple ton Livret A.</p>
        ) : (
          <div className="divide-y divide-divider">
            {internal.map((a) => (
              <InternalAccountForm key={a.id} account={a} />
            ))}
          </div>
        )}
        <datalist id={DATALIST_ID}>
          {overview.counterparties.map((c) => (
            <option key={c.identifier} value={c.identifier}>
              {c.lastLabel ?? ""}
            </option>
          ))}
        </datalist>
        {overview.counterparties.length > 0 && (
          <div className="mt-2 border-t border-divider pt-3">
            <p className="text-xs font-semibold text-n-700">Comptes repérés dans tes virements</p>
            <ul className="mt-2 flex flex-col gap-2">
              {overview.counterparties.map((c) => (
                <li key={c.identifier} className="flex items-center gap-2 text-sm">
                  <code className="min-w-0 break-all font-mono text-xs">{c.identifier}</code>
                  <button
                    type="button"
                    className="shrink-0 rounded p-1 text-n-600 hover:bg-n-100"
                    aria-label={`Copier ${c.identifier}`}
                    onClick={() => {
                      void navigator.clipboard.writeText(c.identifier);
                      toast("Identifiant copié");
                    }}
                  >
                    <Copy size={13} />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-xs text-n-600">
                    {plural(c.count, "ligne")} · dernière le {shortDate(c.lastDate)}
                    {c.lastLabel ? ` · ${c.lastLabel}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {savings.length > 0 && (
        <Card className="lg:col-span-2">
          <div id="interets" className="scroll-mt-24">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Intérêts</h2>
            <p className="mt-1 text-xs text-n-600">Versés directement sur le livret (le 31 décembre pour un Livret A), ils n&apos;apparaissent pas sur le compte courant : saisis-les ici.</p>
          </div>
          <div className="divide-y divide-divider">
            {savings.map((a) => (
              <InterestForm key={a.id} account={a} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
