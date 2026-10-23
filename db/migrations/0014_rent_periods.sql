-- =============================================================================
-- Loyer payé à un proche : historique de périodes. Chaque période commence à une date et fixe la
-- part de loyer (montant par mois ou pourcentage) jusqu'au début de la suivante ; une période à 0
-- marque la fin du loyer (déménagement). La part d'une règle existante devient sa première période.
-- =============================================================================
create table if not exists public.rent_periods (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null,
  user_id uuid not null references public."user" (id) on delete cascade,
  start_date date not null,
  mode text not null check (mode in ('monthly', 'percent')),
  value integer not null check (value >= 0),
  created_at timestamptz not null default now(),
  unique (rule_id, start_date),
  foreign key (rule_id, user_id) references public.rent_rules (id, user_id) on delete cascade
);
create index if not exists rent_periods_rule_idx on public.rent_periods (rule_id);

insert into public.rent_periods (rule_id, user_id, start_date, mode, value)
select r.id, r.user_id, date '2000-01-01', r.mode, r.value
from public.rent_rules r
where not exists (select 1 from public.rent_periods p where p.rule_id = r.id);

alter table public.rent_rules drop column if exists mode;
alter table public.rent_rules drop column if exists value;
