import Link from "next/link";
import { getProfile } from "@/lib/data/queries";
import { listIntegrationKeys } from "@/lib/data/integration-actions";
import { PageHeader } from "@/components/ui/primitives";
import { GKoiSettings } from "./gkoi-settings";

export const metadata = { title: "G Koi À Faire" };

export default async function GKoiSettingsPage() {
  const [profile, keys] = await Promise.all([getProfile(), listIntegrationKeys()]);
  return (
    <>
      <div className="flex flex-col gap-3 pr-12 lg:pr-0">
        <Link href="/parametres" className="text-xs font-bold text-accent-700">
          ‹ Paramètres
        </Link>
        <PageHeader kicker="Application reliée" title="G Koi À Faire" />
      </div>
      <GKoiSettings keys={keys} cushionCents={profile.wishCushionCents} />
    </>
  );
}
