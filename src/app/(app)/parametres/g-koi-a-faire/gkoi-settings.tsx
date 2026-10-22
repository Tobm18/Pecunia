"use client";

import { Copy } from "lucide-react";
import { useState, useTransition } from "react";
import { updateProfile } from "@/lib/data/actions";
import { createIntegrationKey, revokeIntegrationKey, type IntegrationKey } from "@/lib/data/integration-actions";
import { sanitizeAmountInput } from "@/lib/domain/money";
import { Button, Card, Input } from "@/components/ui/primitives";
import { Modal, useToast } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/spinner";
import { Row } from "../settings-form";

const centsToInput = (cents: number) => (cents / 100).toFixed(2).replace(".", ",").replace(",00", "");
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/**
 * G Koi À Faire : envoie ses achats en attente (proposés dans le Prévisionnel) et reçoit la marge du mois.
 * Tant qu'aucune clé n'existe, seule la mise en relation est proposée ; ensuite ses réglages et la connexion.
 */
export function GKoiSettings({ keys, cushionCents }: { keys: IntegrationKey[]; cushionCents: number }) {
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
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      {keys.length === 0 ? (
        <Card>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Connexion</h2>
          <div className="divide-y divide-divider">
            <Row label="Relier G Koi À Faire" hint="Ses achats arrivent dans le Prévisionnel, il reçoit ta marge du mois">
              <Button variant="primary" onClick={create} loading={pending}>
                Relier
              </Button>
            </Row>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-n-700">
              Budget {pending && !confirmRevoke && <Spinner size={12} label="Enregistrement" />}
            </h2>
            <div className="divide-y divide-divider">
              <Row label="Coussin de sécurité" hint="Réserve pour les imprévus">
                <div className="flex w-28 items-center gap-2">
                  <Input
                    inputMode="decimal"
                    value={cushion}
                    onChange={(e) => setCushion(sanitizeAmountInput(e.target.value))}
                    onBlur={saveCushion}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    aria-label="Coussin de sécurité en euros"
                    className="text-right tabular-nums"
                  />
                  <span className="text-sm text-n-700">€</span>
                </div>
              </Row>
            </div>
          </Card>

          <Card>
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Connexion</h2>
            <div className="divide-y divide-divider">
              {keys.map((k) => (
                <Row
                  key={k.id}
                  label={`Clé ${k.start ? `${k.start}…` : ""}`}
                  hint={k.lastRequest ? `Dernière synchronisation le ${shortDate(k.lastRequest)}` : `Créée le ${shortDate(k.createdAt)}, jamais utilisée`}
                >
                  <button type="button" onClick={() => setConfirmRevoke(k)} className="text-sm font-semibold text-danger-700 hover:underline">
                    Révoquer…
                  </button>
                </Row>
              ))}
              <Row label="Nouvelle clé" hint="Si la clé installée dans G Koi À Faire est perdue">
                <Button onClick={create} loading={pending && !confirmRevoke}>
                  Créer
                </Button>
              </Row>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title="Clé de G Koi À Faire"
        footer={<Button variant="primary" onClick={() => setCreated(null)}>J&apos;ai copié la clé</Button>}
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>Copie-la maintenant : elle ne sera plus jamais affichée.</p>
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
            <Button variant="danger" onClick={() => confirmRevoke && revoke(confirmRevoke)} loading={pending}>
              Révoquer
            </Button>
          </>
        }
      >
        <p className="text-sm">G Koi À Faire ne pourra plus synchroniser ses achats ni lire ta marge tant qu&apos;une nouvelle clé n&apos;est pas installée.</p>
      </Modal>
    </div>
  );
}
