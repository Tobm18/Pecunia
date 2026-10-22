import Link from "next/link";
import { notFound } from "next/navigation";
import { AuthShell } from "../auth-shell";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Créer un compte" };

export default function SignupPage() {
  // Usage personnel : l'inscription se ferme une fois le compte créé (NEXT_PUBLIC_ALLOW_SIGNUP=false).
  if (process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "true") notFound();
  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Tes données restent privées, rattachées à ton compte."
      footer={
        <p className="text-[15px] text-n-600">
          Déjà un compte ?{" "}
          <Link href="/login" className="font-semibold text-accent-700">
            Se connecter
          </Link>
        </p>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
