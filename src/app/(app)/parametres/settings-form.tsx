"use client";

import { Download, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { signOut, updateProfile } from "@/lib/data/actions";
import type { Profile } from "@/lib/domain/types";
import { Card, Segmented, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/overlay";
import { Spinner } from "@/components/ui/spinner";
import { SubmitButton } from "@/components/ui/submit-button";
import { APP_NAME, copyrightLine, versionLabel } from "@/lib/version";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
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

export function SettingsForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function save(patch: Parameters<typeof updateProfile>[0], message = "Préférence enregistrée") {
    startTransition(async () => {
      const r = await updateProfile(patch);
      toast(r.ok ? message : r.error, r.ok ? "success" : "error");
      if (r.ok) router.refresh();
    });
  }

  const lastBackup = profile.lastBackupAt
    ? new Date(profile.lastBackupAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    : "jamais";

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
              onChange={(theme) => save({ theme })}
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
            <a href="/import" className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-n-300 px-3 text-sm font-semibold hover:bg-n-100">
              Importer
            </a>
          </Row>
          <Row label="Export CSV" hint="Toutes les transactions, lisible dans Excel">
            <a href="/api/export/csv" className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-n-300 px-3 text-sm font-semibold hover:bg-n-100">
              <Download size={15} /> CSV
            </a>
          </Row>
          <Row label="Sauvegarde JSON" hint={`Dernière sauvegarde : ${lastBackup}`}>
            <a
              href="/api/export/json"
              onClick={() => setTimeout(() => router.refresh(), 1500)}
              className="inline-flex min-h-10 items-center gap-2 rounded-[10px] border border-n-300 px-3 text-sm font-semibold hover:bg-n-100"
            >
              <Download size={15} /> JSON
            </a>
          </Row>
        </div>
      </Card>

      <Card>
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-n-700">Compte</h2>
        <div className="divide-y divide-divider">
          <Row label="Utilisateur">
            <span className="text-sm text-n-700">{profile.email}</span>
          </Row>
          <div className="py-3">
            <form action={signOut}>
              <SubmitButton className="inline-flex min-h-10 items-center gap-2 font-semibold text-danger-700" pendingChildren="Déconnexion…">
                <LogOut size={16} /> Se déconnecter
              </SubmitButton>
            </form>
          </div>
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
