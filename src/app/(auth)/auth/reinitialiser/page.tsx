"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, FieldError, Input, Label, buttonClass } from "@/components/ui/primitives";
import { AuthShell } from "../../auth-shell";

const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);

  // Le lien de l'email arrive ici avec ?token=… (ou ?error=INVALID_TOKEN s'il a expiré)
  const token = () => new URLSearchParams(window.location.search).get("token");
  useEffect(() => {
    if (!token()) setExpired(true);
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) return setError(`Au moins ${MIN_LENGTH} caractères.`);
    if (password !== confirm) return setError("Les deux mots de passe ne correspondent pas.");
    setPending(true);
    const resetToken = token();
    if (!resetToken) {
      setPending(false);
      return setExpired(true);
    }
    try {
      const { error: resetError } = await authClient.resetPassword({ newPassword: password, token: resetToken });
      if (resetError) {
        setPending(false);
        if (resetError.code === "INVALID_TOKEN") return setExpired(true);
        return setError("Impossible de changer le mot de passe, réessaie dans un instant.");
      }
    } catch {
      setPending(false);
      return setError("Impossible de changer le mot de passe, réessaie dans un instant.");
    }
    // les sessions sont révoquées au changement de mot de passe : retour à la connexion
    router.replace("/login?reinitialise=1");
  }

  if (expired) {
    return (
      <AuthShell title="Ce lien n'est plus valide">
        <Link href="/mot-de-passe-oublie" className={buttonClass("primary", "w-full")}>
          Redemander un lien
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Nouveau mot de passe">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div>
          <Label htmlFor="password">Nouveau mot de passe</Label>
          <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="confirm">Confirmation</Label>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <FieldError>{error}</FieldError>
        </div>
        <Button type="submit" variant="primary" loading={pending} className="w-full">
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </form>
    </AuthShell>
  );
}
