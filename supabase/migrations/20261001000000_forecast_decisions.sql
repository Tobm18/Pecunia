-- Prévisionnel validé à la main : décisions par proposition et par mois, séries de lignes prévues.
-- Script idempotent : peut être relancé sans risque.

-- Décision sur une proposition du prévisionnel (échéance de récurrence ou ligne de budget).
-- source_key : « rec:<récurrence>:<date d'échéance> » ou « bud:<catégorie>:<mois> ».
-- Sans décision, la proposition est « à valider » et n'entre pas dans le solde projeté.
create table if not exists public.forecast_decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_key text not null check (source_key ~ '^(rec|bud):'),
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  status text not null check (status in ('accepted', 'rejected')),
  -- valeurs modifiées (vides = celles proposées)
  amount_cents bigint check (amount_cents is null or amount_cents > 0),
  account_id uuid,
  date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_key),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete set null (account_id)
);
create index if not exists forecast_decisions_user_idx on public.forecast_decisions (user_id, month);

alter table public.forecast_decisions enable row level security;
drop policy if exists forecast_decisions_owner on public.forecast_decisions;
create policy forecast_decisions_owner on public.forecast_decisions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Lignes prévues créées pour plusieurs mois d'un coup : même série.
alter table public.forecast_items add column if not exists series_id uuid;

-- La suppression du compte efface aussi les décisions.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.forecast_decisions where user_id = uid;
  delete from public.forecast_items where user_id = uid;
  delete from public.goals where user_id = uid;
  delete from public.transactions where user_id = uid;
  delete from public.recurrences where user_id = uid;
  delete from public.budgets where user_id = uid;
  delete from public.categories where user_id = uid;
  delete from public.accounts where user_id = uid;
  delete from public.profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
