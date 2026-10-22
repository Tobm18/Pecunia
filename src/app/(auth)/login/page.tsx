import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reinitialise?: string }> }) {
  const { reinitialise } = await searchParams;
  return (
    <AuthShell title="Connexion" subtitle="Bon retour.">
      <LoginForm allowSignup={process.env.NEXT_PUBLIC_ALLOW_SIGNUP === "true"} passwordReset={reinitialise === "1"} />
    </AuthShell>
  );
}
