"use client";

import { ChevronRight, Download, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { signOut, updateProfile } from "@/lib/data/actions";
import { deleteMyAccount } from "@/lib/data/planning-actions";
import { applyThemeColor } from "@/lib/theme";
import type { Profile } from "@/lib/domain/types";
import { Button, Card, FieldError, Input, Label, Segmented, Select } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/spinner";
import { SubmitButton } from "@/components/ui/submit-button";
import { APP_NAME, copyrightLine, versionLabel } from "@/lib/version";
import { PushNotificationsRow } from "./push-notifications";

export function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-3">
      <div>
        <p className="font-semibold">{label}</p>
        {hint && <p className="text-xs text-n-600">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

/** Bouton secondaire en forme de lien (même style que « Importer »). */
export const linkButtonClass =
  "inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-n-300 px-3 text-sm font-semibold hover:bg-n-100";

/**
 * gkoiStatus : état de la liaison avec G Koi À Faire (null = pas reliée) ; bankStatus : état de la
 * connexion bancaire (null = pas connectée) ; passkeyCount : passkeys enregistrées.
 */
export function SettingsForm({
  profile,
  gkoiStatus,
  bankStatus,
  passkeyCount,
}: {
  profile: Profile;
  gkoiStatus: string | null;
  bankStatus: string | null;
  passkeyCount: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function save(patch: Parameters<typeof updateProfile>[0], message = "Préférence enregistrée") {
    startTransition(async () => {
      const r = await updateProfile(patch);
      startTransition(() => {
        toast(r.ok ? message : r.error, r.ok ? "success" : "error");
      });
    });
  }

  // Réponse immédiate : le thème s'applique tout de suite (fondu court), l'enregistrement suit
  function changeTheme(theme: Profile["theme"]) {
    const apply = () => {
      document.documentElement.dataset.theme = theme;
      applyThemeColor(theme);
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if ("startViewTransition" in document && !reduce) document.startViewTransition(apply);
    else apply();
    save({ theme });
  }

  const lastBackup = profile.lastBackupAt
    ? new Date(profile.lastBackupAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    : "jamais";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-n-700">
          Préférences {pending && <Spinner size={12} label="Enregistrement" />}
        </h2>
        <div className="divide-y divide-divider">
          <Row label="Devise">
            <span className="text-sm text-n-700">Euro (€)</span>
          </Row>
          <Row label="Format de date">
            <span className="text-sm text-n-700">28/09/2026</span>
          </Row>
          <Row label="Début du mois" hint="Découpage des mois budgétaires dans toute l'app">
            <Select
              value={profile.monthStartDay}
              disabled={pending}
              onChange={(e) => save({ monthStartDay: Number(e.target.value) })}
              aria-label="Début du mois"
              className="w-28"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  le {d}
                </option>
              ))}
            </Select>
          </Row>
          <Row label="Thème">
            <Segmented
              value={profile.theme}
              onChange={changeTheme}
              options={[
                { value: "light", label: "Clair" },
                { value: "dark", label: "Sombre" },
              ]}
            />
          </Row>
        </div>
      </Card>

      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Données</h2>
        <div className="divide-y divide-divider">
          <Row label="Importer un CSV" hint="Historique d'un compte (tableur, export bancaire)">
            <a href="/import" className={linkButtonClass}>
              Importer
            </a>
          </Row>
          <Row label="Export CSV" hint="Toutes les transactions, lisible dans Excel">
            <ExportButton format="csv" label="CSV" />
          </Row>
          <Row label="Sauvegarde JSON" hint={`Dernière sauvegarde : ${lastBackup}`}>
            {/* la date de dernière sauvegarde est rafraîchie une fois le fichier reçu */}
            <ExportButton format="json" label="JSON" onDone={() => router.refresh()} />
          </Row>
          <Row label="Banque" hint={bankStatus ?? "Comptes et transactions importés automatiquement"}>
            <Link href="/parametres/banque" className={linkButtonClass}>
              {bankStatus ? "Gérer" : "Connecter"} <ChevronRight size={15} aria-hidden />
            </Link>
          </Row>
          <Row label="G Koi À Faire" hint={gkoiStatus ?? "Ses achats en attente proposés dans le Prévisionnel"}>
            <Link href="/parametres/g-koi-a-faire" className={linkButtonClass}>
              {gkoiStatus ? "Gérer" : "Relier"} <ChevronRight size={15} aria-hidden />
            </Link>
          </Row>
        </div>
      </Card>

      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Compte</h2>
        <div className="divide-y divide-divider">
          <Row label="Utilisateur">
            <span className="text-sm text-n-700">{profile.email}</span>
          </Row>
          <Row
            label="Passkeys"
            hint={passkeyCount ? `${passkeyCount} enregistrée${passkeyCount > 1 ? "s" : ""} · Face ID, Touch ID` : "Connexion par Face ID ou Touch ID"}
          >
            <Link href="/parametres/passkeys" className={linkButtonClass}>
              {passkeyCount ? "Gérer" : "Ajouter"} <ChevronRight size={15} aria-hidden />
            </Link>
          </Row>
          <PushNotificationsRow />
          <div className="py-3">
            <form action={signOut}>
              <SubmitButton className="inline-flex min-h-10 items-center gap-2 font-semibold text-danger-700" pendingChildren="Déconnexion…">
                <LogOut size={16} /> Se déconnecter
              </SubmitButton>
            </form>
          </div>
          <Row label="Supprimer le compte" hint="Efface définitivement toutes tes données">
            <DeleteAccountButton email={profile.email} />
          </Row>
        </div>
      </Card>

      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">À propos</h2>
        <div className="divide-y divide-divider">
          <Row label="Version">
            <span className="text-sm text-n-700 tabular-nums">
              {APP_NAME} {versionLabel()}
            </span>
          </Row>
          <Row label="Copyright">
            <span className="text-sm text-n-700">{copyrightLine()} · Tous droits réservés</span>
          </Row>
        </div>
      </Card>
    </div>
  );
}

/** Téléchargement d'un export : spinner jusqu'à la réception complète du fichier. */
function ExportButton({ format, label, onDone }: { format: "csv" | "json"; label: string; onDone?: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function download() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/export/${format}`);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `pecunia.${format}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        startTransition(() => onDone?.());
      } catch {
        toast("Export impossible, réessaie dans un instant.", "error");
      }
    });
  }

  return (
    <Button onClick={download} loading={pending}>
      {!pending && <Download size={15} />} {label}
    </Button>
  );
}

/** Suppression définitive : confirmation en retapant l'email ou « SUPPRIMER ». */
function DeleteAccountButton({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const valid = confirmation.trim() === "SUPPRIMER" || confirmation.trim().toLowerCase() === email.toLowerCase();

  function submit() {
    setError(null);
    startTransition(async () => {
      const r = await deleteMyAccount(confirmation);
      startTransition(() => {
        // en cas de succès, l'action redirige vers l'écran de connexion
        if (r && !r.ok) setError(r.error);
      });
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-danger-700 hover:underline">
        Supprimer…
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Supprimer le compte"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Annuler</Button>
            <Button variant="danger" onClick={submit} loading={pending} disabled={!valid}>
              Supprimer définitivement
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            Comptes, transactions, catégories, budgets, récurrences et objectifs seront <strong>définitivement effacés</strong>. Pense à
            faire une sauvegarde JSON avant.
          </p>
          <div>
            <Label htmlFor="delete-confirm">
              Pour confirmer, tape ton adresse email ({email}) ou <strong>SUPPRIMER</strong>
            </Label>
            <Input id="delete-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
          </div>
          <FieldError>{error}</FieldError>
        </div>
      </Modal>
    </>
  );
}
