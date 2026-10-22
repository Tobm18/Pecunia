-- =============================================================================
-- Banque Populaire ne transmet pas le compte en face des virements : un compte interne peut aussi
-- être reconnu par un mot-clé du libellé (« Livret A »). Et les opérations en cours (paiements
-- par carte pas encore comptabilisés) sont importées à part, remplacées à chaque synchronisation.
-- =============================================================================

-- Mot-clé cherché dans le libellé des lignes du compte synchronisé (sans accents ni casse)
alter table public.accounts add column if not exists transfer_keyword text;

-- Soldes renvoyés par la banque à la dernière synchronisation (type, montant, date de référence)
alter table public.bank_accounts add column if not exists bank_balances jsonb;
