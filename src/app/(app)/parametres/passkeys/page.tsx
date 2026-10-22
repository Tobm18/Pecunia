import { listPasskeys } from "@/lib/data/passkey-actions";
import { BackLink, PageHeader } from "@/components/ui/primitives";
import { PasskeySettings } from "./passkey-settings";

export const metadata = { title: "Passkeys" };

export default async function PasskeysPage() {
  const passkeys = await listPasskeys();
  return (
    <>
      <div className="flex flex-col gap-3">
        <BackLink href="/parametres">Paramètres</BackLink>
        <PageHeader kicker="Compte" title="Passkeys" />
      </div>
      <PasskeySettings passkeys={passkeys} />
    </>
  );
}
