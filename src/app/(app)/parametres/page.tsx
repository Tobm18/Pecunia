import { getProfile } from "@/lib/data/queries";
import { listIntegrationKeys } from "@/lib/data/integration-actions";
import { PageHeader } from "@/components/ui/primitives";
import { IntegrationCard } from "./integration-card";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const [profile, keys] = await Promise.all([getProfile(), listIntegrationKeys()]);
  return (
    <>
      <div className="pr-12 lg:pr-0">
        <PageHeader kicker="Gestion" title="Paramètres" />
      </div>
      <SettingsForm profile={profile} />
      <div className="mt-4">
        <IntegrationCard keys={keys} cushionCents={profile.wishCushionCents} />
      </div>
    </>
  );
}
