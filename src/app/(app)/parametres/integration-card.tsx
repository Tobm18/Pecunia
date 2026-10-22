"use client";

import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { updateProfile } from "@/lib/data/actions";
import { createIntegrationKey, revokeIntegrationKey, type IntegrationKey } from "@/lib/data/integration-actions";
import { formatCents, sanitizeAmountInput } from "@/lib/domain/money";
import { Button, Card, Input, Label } from "@/components/ui/primitives";
import { Modal, useToast } from "@/components/ui/overlay";

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(",00", "");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/**
 * Applications reliées : G Koi À Faire envoie ses achats en attente (proposés dans le Prévisionnel)
 * et reçoit la marge du mois. Clé d'API limitée à cet usage, coussin de sécurité.
 */
export function IntegrationCard({ keys, cushionCents }: { keys: IntegrationKey[]; cushionCents: number }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [cushion, setCushion] = useState(centsToInput(cushionCents));
  const [created, setCreated] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<IntegrationKey | null>(null);

  function saveCushion() {
    if (cushion === centsToInput(cushionCents)) return;
    startTransition(async () => {
      const r = await updateProfile({ wishCushion: cushion });
      startTransition(() => toast(r.ok ? "Coussin enregistré" : r.error, r.ok ? "success" : "error"));
    });
  }

  function create() {
    startTransition(async () => {
      const r = await createIntegrationKey("G Koi À Faire");
      startTransition(() => (r.ok ? setCreated(r.data.key) : toast(r.error, "error")));
    });
  }

  function revoke(key: IntegrationKey) {
    startTransition(async () => {
      const r = await revokeIntegrationKey(key.id);
      startTransition(() => {
        setConfirmRevoke(null);
        toast(r.ok ? "Clé révoquée" : r.error, r.ok ? "success" : "error");
      });
    });
  }

  return (
    <Card>
      <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Applications reliées · G Koi À Faire</h2>
      <p className="mt-2 text-sm text-n-700">
        G Koi À Faire envoie ses achats et réparations en attente : ils sont proposés dans le Prévisionnel (oui, non ou modifier). En
        retour, il reçoit ta marge du mois : solde de fin de mois prévu sur tes comptes « dans le budget », moins le coussin ci-dessous.
        La clé ne donne accès à rien d&apos;autre.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-divider pt-3">
        <div className="min-w-40 flex-1">
          <Label htmlFor="wish-cushion">Coussin de sécurité</Label>
          <Input
            id="wish-cushion"
            inputMode="decimal"
            value={cushion}
            onChange={(e) => setCushion(sanitizeAmountInput(e.target.value))}
            onBlur={saveCushion}
            aria-describedby="wish-cushion-hint"
          />
        </div>
        <p id="wish-cushion-hint" className="flex-1 text-xs text-n-600">
          Retiré de la marge communiquée ({formatCents(cushionCents)} actuellement), pour garder une réserve.
        </p>
      </div>

      <div className="mt-3 border-t border-divider pt-3">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold">Clés d&apos;API</p>
          <Button onClick={create} loading={pending && !confirmRevoke}>
            <KeyRound size={15} /> Créer une clé
          </Button>
        </div>
        {keys.length === 0 ? (
          <p className="mt-2 text-sm text-n-600">Aucune clé : G Koi À Faire n&apos;est pas encore relié.</p>
        ) : (
          <ul className="mt-2 divide-y divide-divider">
            {keys.map((k) => (
              <li key={k.id} className="flex min-h-12 items-center justify-between gap-3 py-2">
                <div>
                  <p className="text-sm font-semibold">
                    {k.name ?? "Clé"} <span className="font-mono text-n-600">{k.start ? `${k.start}…` : ""}</span>
                  </p>
                  <p className="text-xs text-n-600">
                    Créée le {shortDate(k.createdAt)} · {k.lastRequest ? `dernier accès le ${shortDate(k.lastRequest)}` : "jamais utilisée"}
                  </p>
                </div>
                <Button onClick={() => setConfirmRevoke(k)} className="!text-danger-700" aria-label={`Révoquer ${k.name ?? "la clé"}`}>
                  <Trash2 size={15} /> Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Nouvelle clé d'API"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>J&apos;ai copié la clé</Button>}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>Copie-la maintenant : elle ne sera plus jamais affichée (seule une empreinte est conservée).</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-n-100 px-3 py-2 font-mono text-xs">{created}</code>
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(created ?? "");
                toast("Clé copiée");
              }}
              aria-label="Copier la clé"
            >
              <Copy size={15} />
            </Button>
          </div>
          <p className="text-n-700">
            Dans le projet G Koi À Faire : <code className="font-mono">npx wrangler secret put PECUNIA_API_KEY</code>, puis colle la clé.
          </p>
        </div>
      </Modal>

      <Modal
        open={confirmRevoke !== null}
        onClose={() => setConfirmRevoke(null)}
        title="Révoquer la clé ?"
        footer={
          <>
            <Button onClick={() => setConfirmRevoke(null)}>Annuler</Button>
            <Button variant="primary" onClick={() => confirmRevoke && revoke(confirmRevoke)} loading={pending} className="!bg-danger-700">
              Révoquer
            </Button>
          </>
        }
      >
        <p className="text-sm">G Koi À Faire ne pourra plus synchroniser ses souhaits ni lire ta marge tant qu&apos;une nouvelle clé n&apos;est pas installée.</p>
      </Modal>
    </Card>
  );
}
