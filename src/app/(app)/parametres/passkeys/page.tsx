import Link from "next/link";
import { listPasskeys } from "@/lib/data/passkey-actions";
import { PageHeader } from "@/components/ui/primitives";
import { PasskeySettings } from "./passkey-settings";

export const metadata = { title: "Passkeys" };

export default async function PasskeysPage() {
  const passkeys = await listPasskeys();
  return (
    <>
      <div className="flex flex-col gap-3 pr-12 lg:pr-0">
        <Link href="/parametres" className="text-xs font-bold text-accent-700">
          ‹ Paramètres
        </Link>
        <PageHeader kicker="Compte" title="Passkeys" />
      </div>
      <PasskeySettings passkeys={passkeys} />
    </>
  );
}
