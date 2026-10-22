"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Banner, Button, FieldError, Input, Label } from "@/components/ui/primitives";
import { AuthShell } from "../auth-shell";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) return setError("Ce champ est obligatoire");
    setPending(true);
    try {
      await authClient.requestPasswordReset({ email: email.trim(), redirectTo: "/auth/reinitialiser" });
    } catch {
      // Confirmation affichée même en cas d'échec : ne pas exposer l'existence d'un compte.
    } finally {
      setPending(false);
      setSent(true);
    }
  }

  return (
    <AuthShell title="Mot de passe oublié" subtitle="Indique ton email, on t'envoie un lien.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <FieldError>{error}</FieldError>
        </div>
        {sent && <Banner tone="success">On t&apos;envoie un lien de réinitialisation valable 30 minutes</Banner>}
        <Button type="submit" variant="primary" loading={pending} className="w-full">
          {pending ? "Envoi…" : "Envoyer le lien"}
        </Button>
        <Link href="/login" className="text-sm font-bold text-accent-700">
          ← Retour à la connexion
        </Link>
      </form>
    </AuthShell>
  );
}
