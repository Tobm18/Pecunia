-- =============================================================================
-- Classement automatique avec score de confiance. Chaque dépense / recette garde l'origine de sa
-- catégorie (manual, learned, memory, rule, directory, fallback, legacy) et un score de 0 à 100 ;
-- sous 70, une catégorie automatique est « à vérifier ». Une catégorie manuelle n'est jamais
-- recalculée. Le cache de l'annuaire des entreprises (SIRENE) évite de chercher deux fois.
-- =============================================================================
alter table public.transactions add column if not exists category_source text;
alter table public.transactions add column if not exists category_confidence smallint;

-- lignes existantes : origine inconnue, reclassées par le premier passage automatique
update public.transactions
set category_source = 'legacy', category_confidence = 60
where category_source is null and type in ('in', 'out');

create index if not exists transactions_review_idx
  on public.transactions (user_id) where category_source is distinct from 'manual' and category_confidence < 70;

-- Annuaire des entreprises : meilleure correspondance trouvée pour un commerçant (clé commerçant +
-- département). score = 0 : rien de fiable trouvé. Données publiques, communes à tous.
create table if not exists public.merchant_directory (
  lookup_key text primary key,
  name text,
  commune text,
  naf text,
  score smallint not null default 0,
  looked_up_at timestamptz not null default now()
);
