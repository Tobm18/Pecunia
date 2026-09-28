import Link from "next/link";
import { buttonClass } from "@/components/ui/primitives";
import { AuthShell } from "../../auth-shell";

export default function InvalidLinkPage() {
  return (
    <AuthShell title="Ce lien n'est plus valide" subtitle="Il a expiré ou a déjà été utilisé.">
      <div className="flex flex-col gap-3">
        <Link href="/mot-de-passe-oublie" className={buttonClass("primary", "w-full")}>
          Redemander un lien
        </Link>
        <Link href="/login" className="text-sm font-bold text-accent-700">
          ← Retour à la connexion
        </Link>
      </div>
    </AuthShell>
  );
}
