"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button, FieldError, Input, Label } from "@/components/ui/primitives";

const REQUIRED = "Ce champ est obligatoire";
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function LoginForm({ allowSignup }: { allowSignup: boolean }) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function validateEmail(): boolean {
    if (!email.trim()) {
      setFieldErrors({ email: REQUIRED });
      emailRef.current?.focus();
      return false;
    }
    if (!isEmail(email.trim())) {
      setFieldErrors({ email: "Adresse email invalide" });
      emailRef.current?.focus();
      return false;
    }
    return true;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!validateEmail()) return;
    if (!password) {
      setFieldErrors({ password: REQUIRED });
      passwordRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const { error: authError } = await authClient.signIn.email({ email: email.trim(), password });
      if (authError) {
        const invalid = authError.status === 401 || authError.code === "INVALID_EMAIL_OR_PASSWORD";
        setError(invalid ? "Email ou mot de passe incorrect" : "Connexion impossible, réessaie dans un instant");
        if (invalid) setPassword("");
        setPending(false);
        return;
      }
      // le spinner reste affiché jusqu'à l'arrivée sur le tableau de bord
      router.replace("/");
      router.refresh();
    } catch {
      setError("Connexion impossible, réessaie dans un instant");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          ref={emailRef}
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!fieldErrors.email}
        />
        <FieldError>{fieldErrors.email}</FieldError>
      </div>
      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input
          id="password"
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={!!fieldErrors.password}
        />
        <FieldError>{fieldErrors.password}</FieldError>
      </div>
      <Button type="submit" variant="primary" loading={pending} disabled={pending} className="w-full">
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
      <FieldError>{error}</FieldError>
      <div className="flex items-center gap-3 text-xs text-n-600">
        <span className="h-px flex-1 bg-divider" />
        ou
        <span className="h-px flex-1 bg-divider" />
      </div>
      <Button disabled title="Bientôt disponible" className="w-full">
        <KeyRound size={16} /> Passkey
      </Button>
      {allowSignup && (
        <p className="text-center text-sm text-n-600">
          Pas encore de compte ?{" "}
          <Link href="/inscription" className="font-bold text-accent-700">
            Créer un compte
          </Link>
        </p>
      )}
    </form>
  );
}
