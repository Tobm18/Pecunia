"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ScanFace } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { AuthButton, AuthError, FieldGroup, GroupInput } from "../auth-shell";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
/** Fenêtre Face ID / Touch ID fermée par l'utilisateur : pas une erreur à afficher. */
const cancelled = (message?: string) => /NotAllowed|abort|cancel|annul/i.test(message ?? "");

export function LoginForm() {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"password" | "passkey" | null>(null);
  const [passkeys, setPasskeys] = useState(false);

  function enterApp() {
    // le spinner reste affiché jusqu'à l'arrivée sur le tableau de bord
    router.replace("/");
    router.refresh();
  }

  useEffect(() => {
    if (typeof window === "undefined" || !window.PublicKeyCredential) return;
    setPasskeys(true);
    // Remplissage automatique : en touchant le champ email, iOS propose la passkey dans la barre QuickType
    void PublicKeyCredential.isConditionalMediationAvailable?.().then((available) => {
      if (!available) return;
      void authClient.signIn.passkey({ autoFill: true }).then(({ error: e }) => {
        if (!e) enterApp();
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInvalid(false);
    if (!isEmail(email.trim())) {
      setInvalid(true);
      setError(email.trim() ? "Adresse email invalide" : "Saisis ton email");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setInvalid(true);
      setError("Saisis ton mot de passe");
      passwordRef.current?.focus();
      return;
    }
    setPending("password");
    try {
      const { error: authError } = await authClient.signIn.email({ email: email.trim(), password });
      if (authError) {
        const wrong = authError.status === 401 || authError.code === "INVALID_EMAIL_OR_PASSWORD";
        setError(wrong ? "Email ou mot de passe incorrect" : "Connexion impossible, réessaie dans un instant");
        if (wrong) {
          setInvalid(true);
          setPassword("");
          passwordRef.current?.focus();
        }
        setPending(null);
        return;
      }
      enterApp();
    } catch {
      setError("Connexion impossible, réessaie dans un instant");
      setPending(null);
    }
  }

  async function withPasskey() {
    setError(null);
    setInvalid(false);
    setPending("passkey");
    const { error: e } = await authClient.signIn.passkey().catch((err: Error) => ({ error: { message: err.message } }));
    if (!e) return enterApp();
    setPending(null);
    if (!cancelled(e.message)) {
      setError("Passkey non reconnue. Connecte-toi avec ton mot de passe, puis ajoute-la dans Paramètres.");
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FieldGroup invalid={invalid}>
        <GroupInput
          label="Email"
          ref={emailRef}
          type="email"
          inputMode="email"
          // « webauthn » : les passkeys apparaissent dans les suggestions du champ
          autoComplete="username webauthn"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={invalid || undefined}
        />
        <GroupInput
          label="Mot de passe"
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={invalid || undefined}
        />
      </FieldGroup>
      <AuthError>{error}</AuthError>
      <AuthButton type="submit" loading={pending === "password"} disabled={pending !== null}>
        {pending === "password" ? "Connexion…" : "Se connecter"}
      </AuthButton>
      {passkeys && (
        <AuthButton variant="secondary" onClick={withPasskey} loading={pending === "passkey"} disabled={pending !== null}>
          {pending !== "passkey" && <ScanFace size={20} className="text-accent" aria-hidden />}
          Se connecter avec une passkey
        </AuthButton>
      )}
    </form>
  );
}
