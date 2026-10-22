"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { authClient } from "@/lib/auth-client";
import { deletePasskey, type PasskeyInfo } from "@/lib/data/passkey-actions";
import { Button, Card } from "@/components/ui/primitives";
import { Modal, useToast } from "@/components/ui/overlay";
import { Row } from "../settings-form";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Nom proposé pour la passkey de cet appareil, pour la reconnaître dans la liste. */
function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  return "Cet appareil";
}

/** Fenêtre Face ID / Touch ID fermée par l'utilisateur : pas une erreur à afficher. */
const cancelled = (message?: string) => /NotAllowed|abort|cancel|annul/i.test(message ?? "");

export function PasskeySettings({ passkeys }: { passkeys: PasskeyInfo[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [supported, setSupported] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<PasskeyInfo | null>(null);

  useEffect(() => setSupported(!!window.PublicKeyCredential), []);

  async function add() {
    setAdding(true);
    const { error } = await authClient.passkey
      .addPasskey({ name: deviceName() })
      .catch((err: Error) => ({ error: { message: err.message, code: undefined as string | undefined } }));
    setAdding(false);
    if (!error) {
      toast("Passkey ajoutée", "success");
      router.refresh();
    } else if ("code" in error && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      toast("Cet appareil a déjà une passkey pour Pecunia", "error");
    } else if (!cancelled(error.message)) {
      toast("Ajout impossible, réessaie dans un instant.", "error");
    }
  }

  function remove(p: PasskeyInfo) {
    startTransition(async () => {
      const r = await deletePasskey(p.id);
      startTransition(() => {
        setConfirmDelete(null);
        toast(r.ok ? "Passkey supprimée" : r.error, r.ok ? "success" : "error");
      });
    });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Connexion sans mot de passe</h2>
        <div className="divide-y divide-divider">
          {passkeys.map((p) => (
            <Row
              key={p.id}
              label={p.name ?? "Passkey"}
              hint={[p.createdAt && `Ajoutée le ${shortDate(p.createdAt)}`, p.backedUp && "synchronisée"].filter(Boolean).join(" · ")}
            >
              <button type="button" onClick={() => setConfirmDelete(p)} className="text-sm font-semibold text-danger-700 hover:underline">
                Supprimer…
              </button>
            </Row>
          ))}
          <Row
            label="Ajouter une passkey"
            hint={supported ? "Face ID, Touch ID ou code de cet appareil" : "Ce navigateur ne gère pas les passkeys"}
          >
            <Button variant={passkeys.length ? "secondary" : "primary"} onClick={add} loading={adding} disabled={!supported}>
              Ajouter
            </Button>
          </Row>
        </div>
      </Card>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Supprimer la passkey ?"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Annuler</Button>
            <Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)} loading={pending}>
              Supprimer
            </Button>
          </>
        }
      >
        <p className="text-sm">
          {confirmDelete?.name ?? "Cet appareil"} ne pourra plus se connecter par passkey. Le mot de passe reste valable. Pense aussi à la retirer de
          ton gestionnaire de mots de passe.
        </p>
      </Modal>
    </div>
  );
}
