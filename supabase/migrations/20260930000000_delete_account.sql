-- Suppression du compte utilisateur (Paramètres → Supprimer le compte).
-- Efface toutes les données de l'utilisateur connecté puis son compte d'authentification.
-- Script idempotent (create or replace) : peut être relancé sans risque.
--
-- Spécifique à Supabase (schéma auth). En auto-hébergé, remplacer la dernière instruction
-- par la suppression de l'utilisateur dans le système d'authentification retenu.

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
