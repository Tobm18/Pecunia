import { notFound } from "next/navigation";
import { AuthShell } from "../auth-shell";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Créer un compte" };

export default function SignupPage() {
  // Usage personnel : l'inscription se ferme une fois le compte créé (NEXT_PUBLIC_ALLOW_SIGNUP=false).
  if (process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "true") notFound();
  return (
    <AuthShell title="Créer un compte" subtitle="Tes données restent privées, rattachées à ton compte.">
      <SignupForm />
    </AuthShell>
  );
}
