-- =============================================================================
-- Souhaits (achats en attente venant d'une autre app, ex. G Koi À Faire) et clés d'API
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Clés d'API (Better Auth, module @better-auth/api-key) : accès d'une autre application,
-- limité par permissions (ex. { "wishes": ["sync"] }). Seul le hash de la clé est stocké.
-- ---------------------------------------------------------------------------
create table if not exists public.apikey (
  id uuid primary key default gen_random_uuid(),
  config_id text not null default 'default',
  name text,
  start text,
  reference_id uuid not null references public."user" (id) on delete cascade,
  prefix text,
  key text not null,
  refill_interval bigint,
  refill_amount integer,
  last_refill_at timestamptz,
  enabled boolean default true,
  rate_limit_enabled boolean default true,
  rate_limit_time_window bigint,
  rate_limit_max integer,
  request_count integer default 0,
  remaining integer,
  last_request timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  permissions text,
  metadata text
);
create index if not exists apikey_key_idx on public.apikey (key);
create index if not exists apikey_reference_idx on public.apikey (reference_id);
create index if not exists apikey_config_idx on public.apikey (config_id);

-- ---------------------------------------------------------------------------
-- Souhaits : copie, tenue à jour par l'app d'origine, de ses achats en attente ayant un coût.
-- Ils deviennent des propositions du prévisionnel (« wish:<id>:<mois> ») ; accepter une
-- proposition crée une ligne prévue liée (forecast_items.wish_id).
-- ---------------------------------------------------------------------------
create table if not exists public.wishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user" (id) on delete cascade,
  source text not null default 'gkoi' check (length(trim(source)) > 0),
  external_id text not null check (length(trim(external_id)) > 0),
  title text not null check (length(trim(title)) > 0),
  amount_cents bigint not null check (amount_cents > 0),
  priority text check (priority in ('high', 'medium', 'low')),
  due_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id),
  unique (id, user_id)
);
create index if not exists wishes_user_idx on public.wishes (user_id);

-- Ligne prévue issue d'un souhait accepté (une au plus par souhait)
alter table public.forecast_items add column if not exists wish_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'forecast_items_wish_fk') then
    alter table public.forecast_items
      add constraint forecast_items_wish_fk foreign key (wish_id, user_id)
      references public.wishes (id, user_id) on delete set null (wish_id);
  end if;
end $$;
create unique index if not exists forecast_items_wish_uniq on public.forecast_items (wish_id) where wish_id is not null;

-- Décisions : nouvelle source « wish:<souhait>:<mois> » (refus pour un mois)
alter table public.forecast_decisions drop constraint if exists forecast_decisions_source_key_check;
alter table public.forecast_decisions
  add constraint forecast_decisions_source_key_check check (source_key ~ '^(rec|bud|wish):');

-- Coussin de sécurité retiré de la marge communiquée à l'app des souhaits
alter table public.profiles add column if not exists wish_cushion_cents bigint not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_wish_cushion_chk') then
    alter table public.profiles add constraint profiles_wish_cushion_chk check (wish_cushion_cents >= 0);
  end if;
end $$;
