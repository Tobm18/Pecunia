import { getProfile } from "@/lib/data/queries";
import { listIntegrationKeys } from "@/lib/data/integration-actions";
import { BackLink, PageHeader } from "@/components/ui/primitives";
import { GKoiSettings } from "./gkoi-settings";

export const metadata = { title: "G Koi À Faire" };

export default async function GKoiSettingsPage() {
  const [profile, keys] = await Promise.all([getProfile(), listIntegrationKeys()]);
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink href="/parametres">Paramètres</BackLink>
        <PageHeader kicker="Application reliée" title="G Koi À Faire" />
      </div>
      <GKoiSettings keys={keys} cushionCents={profile.wishCushionCents} />
    </>
  );
}
