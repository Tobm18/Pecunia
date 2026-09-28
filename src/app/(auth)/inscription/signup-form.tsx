"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { Banner, Button, FieldError, Input, Label } from "@/components/ui/primitives";

const MIN_LENGTH = 8;

export function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) return setError("Email et mot de passe requis.");
    if (password.length < MIN_LENGTH) return setError(`Mot de passe : au moins ${MIN_LENGTH} caractères.`);
    setPending(true);
    const { data, error: signUpError } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: name.trim() || null },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setPending(false);
    if (signUpError) return setError("Inscription impossible, vérifie l'email ou réessaie plus tard.");
    if (data.session) {
      router.replace("/");
      router.refresh();
    } else {
      setCheckEmail(true);
    }
  }

  if (checkEmail) {
    return <Banner tone="success">Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.</Banner>;
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
      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        Créer mon compte
      </Button>
      <Link href="/login" className="text-sm font-bold text-accent-700">
        ← J&apos;ai déjà un compte
      </Link>
    </form>
  );
}
