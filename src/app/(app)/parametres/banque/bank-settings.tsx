"use client";

import { useState, useTransition } from "react";
import { connectBank, disconnectBank, linkBankAccount, syncBank } from "@/lib/data/bank-actions";
import type { BankOverview } from "@/lib/data/bank";
import { formatCents } from "@/lib/domain/money";
import { Banner, Button, Card, Select } from "@/components/ui/primitives";
import { Modal, useToast } from "@/components/ui/overlay";
import { Row } from "../settings-form";

const NONE = "";
const NEW = "new";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
const shortDateTime = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const daysLeft = (iso: string) => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);

/**
 * Banque connectée (Enable Banking, lecture seule) : connexion, liaison de chaque compte bancaire à
 * un compte Pecunia, synchronisation. Les transactions sont ensuite récupérées chaque jour.
 */
export function BankSettings({ overview, justConnected, authError }: { overview: BankOverview; justConnected: boolean; authError: string | null }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { connection } = overview;

  function connect() {
    startTransition(async () => {
      const r = await connectBank();
      if (r.ok) window.location.assign(r.data.url);
      else startTransition(() => toast(r.error, "error"));
    });
  }

  function sync(message?: string) {
    startTransition(async () => {
      const r = await syncBank();
      startTransition(() =>
        toast(r.ok ? message ?? (r.data.inserted ? `${r.data.inserted} transaction${r.data.inserted > 1 ? "s" : ""} importée${r.data.inserted > 1 ? "s" : ""}` : "Déjà à jour") : r.error, r.ok ? "success" : "error"),
      );
    });
  }

  function link(bankAccountId: string, value: string) {
    startTransition(async () => {
      const r = await linkBankAccount({ bankAccountId, target: value === NONE ? null : value });
      if (!r.ok) return startTransition(() => toast(r.error, "error"));
      if (value === NONE) return startTransition(() => toast("Compte délié"));
      const s = await syncBank();
      startTransition(() => toast(s.ok ? `Compte relié · ${s.data.inserted} transaction${s.data.inserted > 1 ? "s" : ""} importée${s.data.inserted > 1 ? "s" : ""}` : s.error, s.ok ? "success" : "error"));
    });
  }

  function disconnect() {
    startTransition(async () => {
      const r = await disconnectBank();
      startTransition(() => {
        setConfirmDisconnect(false);
        toast(r.ok ? "Banque déconnectée" : r.error, r.ok ? "success" : "error");
      });
    });
  }

  const expired = connection?.status === "expired";
  const remaining = connection?.validUntil ? daysLeft(connection.validUntil) : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {(authError || justConnected || !overview.configured || connection?.lastError || (remaining !== null && remaining <= 14 && !expired)) && (
        <div className="flex flex-col gap-2 lg:col-span-2">
          {authError && <Banner tone="danger">{authError}</Banner>}
          {justConnected && !authError && <Banner tone="success">Banque connectée. Relie maintenant chaque compte à un compte Pecunia pour importer ses transactions.</Banner>}
          {!overview.configured && (
            <Banner tone="warn">La connexion bancaire n&apos;est pas configurée sur le serveur (ENABLE_BANKING_APP_ID et ENABLE_BANKING_PRIVATE_KEY).</Banner>
          )}
          {connection?.lastError && <Banner tone="danger">{connection.lastError}</Banner>}
          {remaining !== null && remaining <= 14 && !expired && (
            <Banner tone="warn">L&apos;accès à ta banque expire dans {Math.max(remaining, 0)} jour{remaining > 1 ? "s" : ""} : reconnecte-la pour continuer la synchronisation.</Banner>
          )}
        </div>
      )}

      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Connexion</h2>
        <div className="divide-y divide-divider">
          {!connection ? (
            <Row label={overview.bankName} hint="Lecture seule : Pecunia ne peut ni payer, ni virer">
              <Button variant="primary" onClick={connect} loading={pending} disabled={!overview.configured}>
                Connecter
              </Button>
            </Row>
          ) : (
            <>
              <Row
                label={overview.bankName}
                hint={expired ? "Accès expiré" : connection.validUntil ? `Accès valable jusqu'au ${longDate(connection.validUntil)}` : "Connectée"}
              >
                <Button variant={expired || (remaining !== null && remaining <= 14) ? "primary" : "secondary"} onClick={connect} loading={pending}>
                  Reconnecter
                </Button>
              </Row>
              <Row label="Synchronisation" hint={connection.lastSyncAt ? `Dernière : ${shortDateTime(connection.lastSyncAt)} · automatique chaque jour` : "Jamais synchronisée"}>
                <Button onClick={() => sync()} loading={pending} disabled={expired}>
                  Synchroniser
                </Button>
              </Row>
              <Row label="Déconnecter" hint="Retire l'accès ; les transactions déjà importées restent">
                <button type="button" onClick={() => setConfirmDisconnect(true)} className="text-sm font-semibold text-danger-700 hover:underline">
                  Déconnecter…
                </button>
              </Row>
            </>
          )}
        </div>
      </Card>

      {connection && (
        <Card>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Comptes</h2>
          <div className="divide-y divide-divider">
            {connection.accounts.length === 0 && <p className="py-3 text-sm text-n-600">Aucun compte n&apos;a été autorisé par la banque.</p>}
            {connection.accounts.map((a) => (
              <Row
                key={a.id}
                label={a.name ?? "Compte bancaire"}
                hint={[a.iban ? `…${a.iban.slice(-4)}` : null, a.bankBalanceCents !== null ? formatCents(a.bankBalanceCents) : null].filter(Boolean).join(" · ") || undefined}
              >
                <Select
                  value={a.accountId ?? NONE}
                  onChange={(e) => link(a.id, e.target.value)}
                  disabled={pending || expired}
                  aria-label={`Compte Pecunia alimenté par ${a.name ?? "ce compte bancaire"}`}
                  className="w-44"
                >
                  <option value={NONE}>Ne pas synchroniser</option>
                  {overview.accounts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                  <option value={NEW}>+ Créer « {a.name ?? "Compte bancaire"} »</option>
                </Select>
              </Row>
            ))}
          </div>
        </Card>
      )}

      <Modal
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Déconnecter la banque ?"
        footer={
          <>
            <Button onClick={() => setConfirmDisconnect(false)}>Annuler</Button>
            <Button variant="danger" onClick={disconnect} loading={pending}>
              Déconnecter
            </Button>
          </>
        }
      >
        <p className="text-sm">L&apos;accès est révoqué chez ta banque et la synchronisation s&apos;arrête. Les transactions déjà importées restent dans Pecunia.</p>
      </Modal>
    </div>
  );
}
