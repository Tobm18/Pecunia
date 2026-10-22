import type { Metadata } from "next";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <AuthShell title="Connexion" subtitle="Bon retour.">
      <LoginForm allowSignup={process.env.NEXT_PUBLIC_ALLOW_SIGNUP === "true"} />
    </AuthShell>
  );
}
