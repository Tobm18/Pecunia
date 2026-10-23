-- =============================================================================
-- Loyer payé à un proche : une règle désigne le proche (clé commerçant de ses virements) et la
-- part de loyer (montant par mois ou pourcentage). La part loyer d'un virement est détachée en une
-- ligne « fille » (split_of) de la catégorie choisie ; la ligne d'origine garde le reste. Le total
-- des deux est toujours le montant du virement : le solde du compte ne change pas.
-- =============================================================================
create table if not exists public.rent_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user" (id) on delete cascade,
  merchant_key text not null check (length(trim(merchant_key)) > 0),
  mode text not null check (mode in ('monthly', 'percent')),
  value integer not null check (value > 0),
  category_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id, merchant_key),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

-- part détachée d'un virement (supprimée avec lui) et règle qui l'a produite
alter table public.transactions add column if not exists split_of uuid references public.transactions (id) on delete cascade;
alter table public.transactions add column if not exists rent_rule_id uuid references public.rent_rules (id) on delete set null;
create index if not exists transactions_split_of_idx on public.transactions (split_of) where split_of is not null;
