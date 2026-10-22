import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  const allowSignup = process.env.NEXT_PUBLIC_ALLOW_SIGNUP === "true";
  return (
    <AuthShell
      title="Pecunia"
      subtitle="Chaque euro à sa place."
      footer={
        allowSignup && (
          <p className="text-[15px] text-n-600">
            Pas encore de compte ?{" "}
            <Link href="/inscription" className="font-semibold text-accent-700">
              Créer un compte
            </Link>
          </p>
        )
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
