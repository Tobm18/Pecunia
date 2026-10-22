-- =============================================================================
-- Diagnostic : dernières écritures brutes (virements et opérations en cours) renvoyées par la
-- banque, pour voir quels champs elle remplit réellement. Remplacé à chaque synchronisation.
-- =============================================================================
alter table public.bank_accounts add column if not exists raw_sample jsonb;
