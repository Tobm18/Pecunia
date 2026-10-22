-- =============================================================================
-- Passkeys (Better Auth, module @better-auth/passkey) : connexion par Face ID / Touch ID ou
-- clé de sécurité (WebAuthn), en plus du mot de passe. Seule la clé publique est stockée.
-- =============================================================================
create table if not exists public.passkey (
  id uuid primary key default gen_random_uuid(),
  name text,
  public_key text not null,
  user_id uuid not null references public."user" (id) on delete cascade,
  credential_id text not null,
  counter integer not null default 0,
  device_type text not null,
  backed_up boolean not null default false,
  transports text,
  created_at timestamptz default now(),
  aaguid text
);
create index if not exists passkey_user_idx on public.passkey (user_id);
create unique index if not exists passkey_credential_idx on public.passkey (credential_id);
