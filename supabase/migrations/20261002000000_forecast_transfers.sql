-- Virements internes prévus dans le prévisionnel.
-- Une ligne prévue avec un compte de destination est un virement : amount_cents (négatif)
-- sur account_id, son opposé sur to_account_id. Script idempotent.
alter table public.forecast_items add column if not exists to_account_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'forecast_items_to_account_fk') then
    alter table public.forecast_items
      add constraint forecast_items_to_account_fk
      foreign key (to_account_id) references public.accounts (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'forecast_items_transfer_check') then
    alter table public.forecast_items
      add constraint forecast_items_transfer_check
      check (to_account_id is null or (to_account_id <> account_id and amount_cents < 0));
  end if;
end $$;
