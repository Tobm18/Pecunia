-- =============================================================================
-- Virements reçus d'un compte interne : leur libellé désigne la destination (« Vir. vers Compte
-- Du Personnel »), jamais la source. Un second mot-clé, propre aux lignes créditrices, les rattache
-- au compte interne d'où ils viennent.
-- =============================================================================
alter table public.accounts add column if not exists transfer_keyword_in text;
