"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthButton, AuthError, FieldGroup, GroupInput } from "../auth-shell";

const MIN_LENGTH = 8;

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError("Email et mot de passe requis.");
    if (password.length < MIN_LENGTH) return setError(`Mot de passe : au moins ${MIN_LENGTH} caractères.`);
    setPending(true);
    const { error: signUpError } = await authClient.signUp
      .email({ email: email.trim(), password, name: name.trim() })
      // erreur réseau : même message, et le spinner s'arrête
      .catch((err: unknown) => ({ error: err }));
    if (signUpError) {
      setPending(false);
      return setError("Inscription impossible, vérifie l'email ou réessaie plus tard.");
    }
    // connecté dès l'inscription ; le spinner reste affiché jusqu'à l'arrivée sur le tableau de bord
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <FieldGroup invalid={!!error}>
        <GroupInput label="Prénom (facultatif)" autoComplete="given-name" enterKeyHint="next" value={name} onChange={(e) => setName(e.target.value)} />
        <GroupInput
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <GroupInput
          label={`Mot de passe (${MIN_LENGTH} caractères min.)`}
          type="password"
          autoComplete="new-password"
          enterKeyHint="go"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </FieldGroup>
      <AuthError>{error}</AuthError>
      <AuthButton type="submit" loading={pending}>
        {pending ? "Création du compte…" : "Créer mon compte"}
      </AuthButton>
    </form>
  );
}
