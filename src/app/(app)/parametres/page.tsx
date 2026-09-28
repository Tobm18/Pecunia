import { getProfile } from "@/lib/data/queries";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Paramètres" };

export default async function SettingsPage() {
  const profile = await getProfile();
  return (
    <>
      <div className="pr-12 lg:pr-0">
        <PageHeader kicker="Gestion" title="Paramètres" />
      </div>
      <SettingsForm profile={profile} />
    </>
  );
}
