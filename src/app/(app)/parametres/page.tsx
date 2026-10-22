import { getBankOverview } from "@/lib/data/bank";
import { getProfile, getSession } from "@/lib/data/queries";
import { listIntegrationKeys } from "@/lib/data/integration-actions";
import { listPasskeys } from "@/lib/data/passkey-actions";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const [profile, keys, passkeys, { user }] = await Promise.all([getProfile(), listIntegrationKeys(), listPasskeys(), getSession()]);
  const { connection } = await getBankOverview(user.id);
  const bankStatus = !connection
    ? null
    : connection.status === "active"
      ? connection.lastSyncAt
        ? `Connectée · synchronisée le ${new Date(connection.lastSyncAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
        : "Connectée · à relier à tes comptes"
      : "Accès expiré · à reconnecter";
  const lastSync = keys.map((k) => k.lastRequest).filter((d): d is string => !!d).sort().at(-1);
  const gkoiStatus = !keys.length
    ? null
    : lastSync
      ? `Reliée · synchronisée le ${new Date(lastSync).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
      : "Reliée · en attente de synchronisation";
  return (
    <>
      <div>
        <PageHeader kicker="Gestion" title="Paramètres" />
      </div>
      <SettingsForm profile={profile} gkoiStatus={gkoiStatus} bankStatus={bankStatus} passkeyCount={passkeys.length} />
    </>
  );
}
