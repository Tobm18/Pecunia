"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { WebAuthnAbortService } from "@simplewebauthn/browser";
import { authClient } from "@/lib/auth-client";
import { deletePasskey, renamePasskey, type PasskeyInfo } from "@/lib/data/passkey-actions";
import { Button, Card, FieldError, Input, Label } from "@/components/ui/primitives";
import { Modal, useToast } from "@/components/ui/overlay";
import { Row } from "../settings-form";

/** Au-delà, la fenêtre Face ID / Touch ID ne s'ouvrira plus : on arrête le chargement. */
const ADD_TIMEOUT_MS = 90_000;
const NAME_MAX = 40;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Nom proposé pour la passkey de cet appareil, modifiable avant la création. */
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

/** Feuille de saisie du nom : ajout (nom proposé d'après l'appareil) ou renommage. */
type NameSheet = { mode: "add" } | { mode: "rename"; passkey: PasskeyInfo };

export function PasskeySettings({ passkeys }: { passkeys: PasskeyInfo[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [supported, setSupported] = useState(true);
  const [sheet, setSheet] = useState<NameSheet | null>(null);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PasskeyInfo | null>(null);

  useEffect(() => setSupported(!!window.PublicKeyCredential), []);

  function openSheet(next: NameSheet) {
    setName(next.mode === "add" ? deviceName() : (next.passkey.name ?? ""));
    setNameError(null);
    setSheet(next);
  }

  function validName(): string | null {
    const clean = name.trim();
    if (!clean) setNameError("Donne un nom à la passkey.");
    else if (clean.length > NAME_MAX) setNameError(`${NAME_MAX} caractères au plus.`);
    else return clean;
    return null;
  }

  async function add(clean: string) {
    setAdding(true);
    // une demande de passkey restée en attente (connexion) empêcherait Face ID de s'ouvrir sur iPhone
    WebAuthnAbortService.cancelCeremony();
    const timeout = new Promise<{ error: { message: string; code: string } }>((resolve) =>
      setTimeout(() => resolve({ error: { message: "timeout", code: "TIMEOUT" } }), ADD_TIMEOUT_MS),
    );
    const { error } = await Promise.race([
      authClient.passkey
        .addPasskey({ name: clean })
        .catch((err: Error) => ({ error: { message: err.message, code: undefined as string | undefined } })),
      timeout,
    ]);
    setAdding(false);
    if (error && "code" in error && error.code === "TIMEOUT") {
      WebAuthnAbortService.cancelCeremony();
      toast("Face ID ne s'est pas ouvert. Ferme complètement l'app, rouvre-la, puis réessaie.", "error");
      return;
    }
    if (!error) {
      setSheet(null);
      toast("Passkey ajoutée", "success");
      router.refresh();
    } else if ("code" in error && error.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
      setNameError("Cet appareil a déjà une passkey pour Pecunia.");
    } else if (!cancelled(error.message)) {
      setNameError("Ajout impossible, réessaie dans un instant.");
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!sheet) return;
    const clean = validName();
    if (!clean) return;
    // appelé directement depuis le geste (bouton) : Safari n'ouvre Face ID qu'à cette condition
    if (sheet.mode === "add") return void add(clean);
    const { passkey } = sheet;
    startTransition(async () => {
      const r = await renamePasskey(passkey.id, clean);
      startTransition(() => {
        if (!r.ok) return setNameError(r.error);
        setSheet(null);
        toast("Passkey renommée", "success");
      });
    });
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

  const busy = adding || (pending && sheet !== null);

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
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => openSheet({ mode: "rename", passkey: p })}
                  className="min-h-10 text-sm font-semibold text-accent-700 hover:underline"
                >
                  Renommer
                </button>
                <button type="button" onClick={() => setConfirmDelete(p)} className="min-h-10 text-sm font-semibold text-danger-700 hover:underline">
                  Supprimer…
                </button>
              </div>
            </Row>
          ))}
          <Row
            label="Ajouter une passkey"
            hint={supported ? "Face ID, Touch ID ou code de cet appareil" : "Ce navigateur ne gère pas les passkeys"}
          >
            <Button variant={passkeys.length ? "secondary" : "primary"} onClick={() => openSheet({ mode: "add" })} disabled={!supported}>
              Ajouter
            </Button>
          </Row>
        </div>
      </Card>

      <Modal
        open={sheet !== null}
        onClose={() => !busy && setSheet(null)}
        title={sheet?.mode === "rename" ? "Renommer la passkey" : "Nouvelle passkey"}
        footer={
          <>
            <Button onClick={() => setSheet(null)} disabled={busy}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" form="passkey-name" loading={busy}>
              {sheet?.mode === "rename" ? "Enregistrer" : "Ajouter la passkey"}
            </Button>
          </>
        }
      >
        <form id="passkey-name" onSubmit={submit} className="flex flex-col gap-1.5" noValidate>
          <Label htmlFor="passkey-name-input">Nom</Label>
          <Input
            id="passkey-name-input"
            value={name}
            maxLength={NAME_MAX}
            autoComplete="off"
            enterKeyHint="done"
            onChange={(e) => {
              setName(e.target.value);
              setNameError(null);
            }}
            aria-invalid={!!nameError}
          />
          <FieldError>{nameError}</FieldError>
          <p className="text-xs text-n-600">Pour la reconnaître dans la liste, par exemple « iPhone de Tom » ou « Mac du bureau ».</p>
        </form>
      </Modal>

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
