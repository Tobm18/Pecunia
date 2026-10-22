"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, FieldError, Input, Label } from "@/components/ui/primitives";

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
      <div>
        <Label htmlFor="name">Prénom (facultatif)</Label>
        <Input id="name" autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="password">Mot de passe</Label>
        <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <FieldError>{error}</FieldError>
      <Button type="submit" variant="primary" loading={pending} className="w-full">
        {pending ? "Création du compte…" : "Créer mon compte"}
      </Button>
      <Link href="/login" className="text-sm font-bold text-accent-700">
        ← J&apos;ai déjà un compte
      </Link>
    </form>
  );
}
