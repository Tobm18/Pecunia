-- Pecunia - schéma initial
--
-- Script IDEMPOTENT : il peut être relancé en entier sans erreur, même si une
-- exécution précédente s'est arrêtée en cours de route (Supabase SQL Editor :
-- coller TOUT le fichier, sans rien sélectionner, puis « Run »).
--
-- Conçu pour rester du PostgreSQL standard (migration Supabase → auto-hébergé) :
--   * aucun trigger sur auth.users : l'initialisation d'un utilisateur (catégories
--     par défaut, premier compte) est faite par l'application ;
--   * seules les politiques RLS dépendent de Supabase via auth.uid(). En
--     auto-hébergé, on redéfinit auth.uid() (ex. lecture d'un setting de session)
--     ou on filtre par user_id dans la couche API.
--
-- Montants : entiers en centimes (bigint) pour éviter toute erreur d'arrondi.
-- Transactions : montant SIGNÉ du point de vue du compte (sortie < 0, entrée > 0).
-- Un virement = deux lignes (source négative, destination positive) liées par
-- transfer_id, si bien que solde = solde initial + somme des lignes du compte.

-- gen_random_uuid() est natif depuis PostgreSQL 13 : aucune extension requise.

-- ---------------------------------------------------------------------------
-- Types énumérés (créés seulement s'ils n'existent pas)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_type' and typnamespace = 'public'::regnamespace) then
    create type public.account_type as enum ('current', 'savings', 'cash');
  end if;
  if not exists (select 1 from pg_type where typname = 'budget_mode' and typnamespace = 'public'::regnamespace) then
    create type public.budget_mode as enum ('fixed', 'percent');
  end if;
  if not exists (select 1 from pg_type where typname = 'transaction_type' and typnamespace = 'public'::regnamespace) then
    create type public.transaction_type as enum ('out', 'in', 'transfer', 'interest', 'adjust');
  end if;
  if not exists (select 1 from pg_type where typname = 'recurrence_frequency' and typnamespace = 'public'::regnamespace) then
    create type public.recurrence_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
  end if;
  if not exists (select 1 from pg_type where typname = 'forecast_status' and typnamespace = 'public'::regnamespace) then
    create type public.forecast_status as enum ('planned', 'linked');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Profils / préférences
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key,                       -- = auth.users.id
  email text not null,
  display_name text,
  currency text not null default 'EUR',
  date_format text not null default 'dd/MM/yyyy',
  month_start_day smallint not null default 1 check (month_start_day between 1 and 28),
  theme text not null default 'light' check (theme in ('light', 'dark')),
  reference_income_cents bigint not null default 0 check (reference_income_cents >= 0),
  budget_carry_over boolean not null default false,
  last_backup_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Comptes
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  type public.account_type not null default 'current',
  initial_balance_cents bigint not null default 0,
  initial_balance_date date not null default current_date,
  color text not null default '#334155',
  icon text not null default 'card',
  in_budget boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  -- cible des clés étrangères composites (empêche de référencer le compte d'un autre utilisateur)
  unique (id, user_id)
);
create index if not exists accounts_user_idx on public.accounts (user_id);

-- ---------------------------------------------------------------------------
-- Catégories
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#94a3b8',
  icon text not null default 'circle',
  is_income boolean not null default false,
  restricted_account_ids uuid[] not null default '{}',
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists categories_user_idx on public.categories (user_id);
-- « Ce nom existe déjà » : unicité insensible à la casse parmi les catégories actives
create unique index if not exists categories_user_name_uniq
  on public.categories (user_id, lower(trim(name)))
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Budgets (un par catégorie)
-- ---------------------------------------------------------------------------
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category_id uuid not null,
  mode public.budget_mode not null default 'fixed',
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  percent numeric(5, 2) check (percent is null or (percent >= 0 and percent <= 100)),
  created_at timestamptz not null default now(),
  unique (category_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);
create index if not exists budgets_user_idx on public.budgets (user_id);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null,
  type public.transaction_type not null,
  amount_cents bigint not null check (amount_cents <> 0),
  date date not null,
  place text,
  category_id uuid,
  note text,
  -- virements : compte en face et identifiant commun aux deux lignes
  counterpart_account_id uuid,
  transfer_id uuid,
  recurrence_id uuid,
  created_at timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (counterpart_account_id, user_id) references public.accounts (id, user_id) on delete set null (counterpart_account_id),
  constraint transactions_sign_chk check (
    (type = 'out' and amount_cents < 0)
    or (type in ('in', 'interest') and amount_cents > 0)
    or type in ('transfer', 'adjust')
  ),
  constraint transactions_transfer_chk check (
    (type = 'transfer') = (transfer_id is not null)
  )
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_account_idx on public.transactions (account_id, date desc);
create index if not exists transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;
create index if not exists transactions_place_idx on public.transactions (user_id, lower(place));

-- ---------------------------------------------------------------------------
-- Évolutions (v2) - tables créées dès maintenant pour figer le modèle
-- ---------------------------------------------------------------------------
create table if not exists public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type public.transaction_type not null check (type in ('out', 'in', 'transfer')),
  label text not null check (length(trim(label)) > 0),
  amount_cents bigint not null check (amount_cents > 0),
  category_id uuid references public.categories (id) on delete set null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  to_account_id uuid references public.accounts (id) on delete cascade,
  frequency public.recurrence_frequency not null default 'monthly',
  due_day smallint not null default 1 check (due_day between 1 and 31),
  start_date date not null,
  end_date date,
  is_subscription boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists recurrences_user_idx on public.recurrences (user_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_recurrence_fk') then
    alter table public.transactions
      add constraint transactions_recurrence_fk
      foreign key (recurrence_id) references public.recurrences (id) on delete set null;
  end if;
end $$;

create table if not exists public.forecast_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  label text not null,
  amount_cents bigint not null check (amount_cents <> 0),   -- signé
  date date not null,
  status public.forecast_status not null default 'planned',
  linked_transaction_id uuid references public.transactions (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists forecast_items_user_idx on public.forecast_items (user_id, date);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  target_cents bigint not null check (target_cents > 0),
  target_date date not null,
  created_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals (user_id);

-- ---------------------------------------------------------------------------
-- Vues de lecture
-- ---------------------------------------------------------------------------
-- Solde courant par compte = solde initial + somme signée des transactions
create or replace view public.account_balances
with (security_invoker = true) as
select
  a.id as account_id,
  a.user_id,
  a.initial_balance_cents + coalesce(sum(t.amount_cents), 0) as balance_cents,
  count(t.id) as transaction_count
from public.accounts a
left join public.transactions t on t.account_id = a.id
group by a.id;

-- Mémoire des lieux : dernière catégorie / dernier compte utilisés pour chaque lieu
create or replace view public.place_memory
with (security_invoker = true) as
select distinct on (t.user_id, lower(trim(t.place)))
  t.user_id,
  trim(t.place) as place,
  t.category_id,
  t.account_id,
  t.date as last_used
from public.transactions t
where t.place is not null
  and length(trim(t.place)) > 0
  and t.type in ('out', 'in', 'interest')
order by t.user_id, lower(trim(t.place)), t.date desc, t.created_at desc;

-- ---------------------------------------------------------------------------
-- Row Level Security : chaque utilisateur ne voit que ses lignes
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
drop policy if exists "profiles_owner" on public.profiles;
create policy "profiles_owner" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'budgets', 'transactions',
    'recurrences', 'forecast_items', 'goals'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t
    );
  end loop;
end $$;
