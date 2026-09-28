"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { KeyRound, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Banner, Button, FieldError, Input, Label } from "@/components/ui/primitives";

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
  const [info, setInfo] = useState<string | null>(null);
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
    setInfo(null);
    setFieldErrors({});
    if (!validateEmail()) return;
    if (!password) {
      setFieldErrors({ password: REQUIRED });
      passwordRef.current?.focus();
      return;
    }
    setPending(true);
    try {
      const { error: authError } = await createClient().auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        const invalid = authError.status === 400 || authError.code === "invalid_credentials";
        setError(invalid ? "Email ou mot de passe incorrect" : "Connexion impossible, réessaie dans un instant");
        if (invalid) setPassword("");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Connexion impossible, réessaie dans un instant");
    } finally {
      setPending(false);
    }
  }

  async function sendMagicLink() {
    setError(null);
    setInfo(null);
    setFieldErrors({});
    if (!validateEmail()) return;
    setPending(true);
    try {
      await createClient().auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
    } catch {
      // Message neutre dans tous les cas : ne jamais révéler si le compte existe.
    } finally {
      setPending(false);
      setInfo("Si un compte existe pour cet email, un lien vient d'être envoyé");
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
      <Link href="/mot-de-passe-oublie" className="self-start text-sm font-bold text-accent-700 hover:text-accent">
        Mot de passe oublié ?
      </Link>
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Connexion…" : "Se connecter"}
      </Button>
      <FieldError>{error}</FieldError>
      {info && <Banner tone="success">{info}</Banner>}
      <div className="flex items-center gap-3 text-xs text-n-500">
        <span className="h-px flex-1 bg-divider" />
        ou
        <span className="h-px flex-1 bg-divider" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={sendMagicLink} disabled={pending}>
          <Mail size={16} /> Lien magique
        </Button>
        <Button disabled title="Bientôt disponible">
          <KeyRound size={16} /> Passkey
        </Button>
      </div>
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
