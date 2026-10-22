-- =============================================================================
-- Moitiés de virement orphelines : l'autre moitié est partie avec un compte supprimé. Elles
-- redeviennent de simples entrées / sorties, pour pouvoir être reliées de nouveau (import CSV,
-- comptes internes reconnus à la synchronisation).
-- =============================================================================
update public.transactions t
set type = case when t.amount_cents < 0 then 'out'::public.transaction_type else 'in'::public.transaction_type end,
    transfer_id = null,
    counterpart_account_id = null
where t.type = 'transfer'
  and not exists (select 1 from public.transactions o where o.transfer_id = t.transfer_id and o.id <> t.id);
