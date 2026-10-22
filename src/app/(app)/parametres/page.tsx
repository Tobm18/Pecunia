import { getProfile } from "@/lib/data/queries";
import { listIntegrationKeys } from "@/lib/data/integration-actions";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const [profile, keys] = await Promise.all([getProfile(), listIntegrationKeys()]);
  const lastSync = keys.map((k) => k.lastRequest).filter((d): d is string => !!d).sort().at(-1);
  const gkoiStatus = !keys.length
    ? null
    : lastSync
      ? `Reliée · synchronisée le ${new Date(lastSync).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`
      : "Reliée · en attente de synchronisation";
  return (
    <>
      <div className="pr-12 lg:pr-0">
        <PageHeader kicker="Gestion" title="Paramètres" />
      </div>
      <SettingsForm profile={profile} gkoiStatus={gkoiStatus} />
    </>
  );
}
