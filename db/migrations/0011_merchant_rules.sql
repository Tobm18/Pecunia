-- =============================================================================
-- Apprentissage de la catégorisation : une catégorie choisie pour un commerçant (clé commerçant,
-- ex. « decathlon », « escota antibes ») vaut pour toutes ses lignes, passées et à venir.
-- =============================================================================
create table if not exists public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user" (id) on delete cascade,
  merchant_key text not null check (length(trim(merchant_key)) > 0),
  category_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);
create index if not exists merchant_rules_user_idx on public.merchant_rules (user_id);
