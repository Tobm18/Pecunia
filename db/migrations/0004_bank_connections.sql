-- =============================================================================
-- Connexion bancaire (Enable Banking, lecture seule) : consentement donné à la banque,
-- comptes distants et lien avec les comptes Pecunia. Les transactions importées gardent la
-- référence de la banque (bank_ref) : une synchronisation relancée ne crée jamais de doublon.
-- =============================================================================
create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user" (id) on delete cascade,
  aspsp_name text not null,
  -- jeton anti-falsification de l'aller-retour vers la banque, effacé une fois la session créée
  state text,
  -- identifiant de session Enable Banking (null tant que le consentement n'est pas donné)
  session_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'error')),
  valid_until timestamptz,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists bank_connections_user_idx on public.bank_connections (user_id);
create unique index if not exists bank_connections_state_idx on public.bank_connections (state) where state is not null;

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user" (id) on delete cascade,
  connection_id uuid not null,
  -- identifiant du compte chez Enable Banking, valable tant que la session l'est
  uid text not null,
  iban text,
  name text,
  currency text,
  -- compte Pecunia alimenté (null = non synchronisé)
  account_id uuid,
  -- dernier jour déjà récupéré ; la synchronisation suivante repart quelques jours avant
  synced_until date,
  bank_balance_cents bigint,
  unique (connection_id, uid),
  foreign key (connection_id, user_id) references public.bank_connections (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete set null (account_id)
);
create index if not exists bank_accounts_user_idx on public.bank_accounts (user_id);

alter table public.transactions add column if not exists bank_ref text;
create unique index if not exists transactions_bank_ref_uniq
  on public.transactions (user_id, account_id, bank_ref) where bank_ref is not null;
