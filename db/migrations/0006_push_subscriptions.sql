-- =============================================================================
-- Notifications push (Web Push) : un abonnement par appareil où elles ont été activées.
-- Les clés sont celles du navigateur (chiffrement des messages), pas des secrets de l'app.
-- =============================================================================
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user" (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
