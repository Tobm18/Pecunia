-- =============================================================================
-- Règles de virements à un proche (loyer, remboursement d'un crédit…) : date de fin facultative.
-- Après elle, plus aucun virement au proche n'est compté dans la catégorie de la règle.
-- =============================================================================
alter table public.rent_rules add column if not exists end_date date;
