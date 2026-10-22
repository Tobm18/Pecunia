-- =============================================================================
-- Comptes internes (livrets…) suivis par les virements du compte synchronisé : une ligne
-- bancaire dont le compte en face (compte créditeur d'un débit, donneur d'ordre d'un crédit)
-- est celui d'un compte interne devient un virement entre les deux comptes Pecunia.
-- =============================================================================

-- Compte en face d'une ligne bancaire (IBAN ou numéro, sans espaces, en majuscules)
alter table public.transactions add column if not exists bank_counterparty text;
create index if not exists transactions_counterparty_idx
  on public.transactions (user_id, bank_counterparty) where bank_counterparty is not null and transfer_id is null;

-- IBAN ou numéro du compte interne, cherché dans les virements
alter table public.accounts add column if not exists bank_identifier text;

-- Solde réel connu à une date : le solde initial en est déduit, même quand l'historique se complète
alter table public.accounts add column if not exists reference_balance_cents bigint;
alter table public.accounts add column if not exists reference_balance_date date;

-- Les lignes déjà importées n'ont pas encore leur compte en face : la prochaine synchronisation
-- récupère de nouveau tout l'historique disponible (sans doublon, grâce à bank_ref).
update public.bank_accounts set synced_until = null;
