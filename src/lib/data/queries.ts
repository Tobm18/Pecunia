import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_ACCOUNT, DEFAULT_CATEGORIES } from "@/lib/domain/defaults";
import type { Account, Budget, Category, ForecastItem, Goal, PlaceMemoryEntry, Profile, Recurrence, Transaction } from "@/lib/domain/types";
import { toAccount, toBudget, toCategory, toForecastItem, toGoal, toPlaceMemory, toProfile, toRecurrence, toTransaction } from "./mappers";

/**
 * Couche de lecture côté serveur. Toute la dépendance à Supabase est confinée ici et dans
 * actions.ts : pour l'auto-hébergement, seules ces deux couches sont à réécrire.
 */

const PAGE = 1000; // limite par défaut de PostgREST

export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
});

/** Crée le profil, les catégories par défaut et un premier compte à la 1re connexion. */
async function initializeUser(): Promise<void> {
  const { supabase, user } = await getSession();
  const { error } = await supabase
    .from("profiles")
    .insert({ id: user.id, email: user.email ?? "", display_name: user.user_metadata?.display_name ?? null });
  if (error) {
    // Course entre deux requêtes parallèles : le profil existe déjà, rien à faire.
    if (error.code === "23505") return;
    throw error;
  }
  await supabase.from("categories").insert(
    DEFAULT_CATEGORIES.map((c, i) => ({
      user_id: user.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      is_income: c.isIncome ?? false,
      sort_order: i,
    })),
  );
  await supabase.from("accounts").insert({
    user_id: user.id,
    name: DEFAULT_ACCOUNT.name,
    type: DEFAULT_ACCOUNT.type,
    icon: DEFAULT_ACCOUNT.icon,
    color: DEFAULT_ACCOUNT.color,
    in_budget: true,
  });
}

export const getProfile = cache(async (): Promise<Profile> => {
  const { supabase, user } = await getSession();
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) return toProfile(data);
  await initializeUser();
  const { data: created, error: err2 } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (err2) throw err2;
  return toProfile(created);
});

export const getAccounts = cache(async (): Promise<Account[]> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("accounts").select("*").order("sort_order").order("created_at");
  if (error) throw error;
  return data.map(toAccount);
});

export const getCategories = cache(async (): Promise<Category[]> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("categories").select("*").order("sort_order").order("created_at");
  if (error) throw error;
  return data.map(toCategory);
});

export const getBudgets = cache(async (): Promise<Budget[]> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("budgets").select("*");
  if (error) throw error;
  return data.map(toBudget);
});

/** Solde courant et nombre de transactions par compte. */
export const getBalances = cache(async (): Promise<Map<string, { balanceCents: number; count: number }>> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("account_balances").select("*");
  if (error) throw error;
  return new Map(
    data.map((r) => [r.account_id as string, { balanceCents: Number(r.balance_cents), count: Number(r.transaction_count) }]),
  );
});

export const getPlaceMemory = cache(async (): Promise<PlaceMemoryEntry[]> => {
  const { supabase } = await getSession();
  const rows: PlaceMemoryEntry[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("place_memory")
      .select("*")
      .order("last_used", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data.map(toPlaceMemory));
    if (data.length < PAGE) break;
  }
  return rows;
});

export interface TransactionQuery {
  from?: string;
  to?: string;
  accountId?: string | null;
}

/** Transactions d'une période (bornes incluses), paginées pour dépasser la limite de 1000 lignes. */
export async function getTransactions(query: TransactionQuery = {}): Promise<Transaction[]> {
  const { supabase } = await getSession();
  const rows: Transaction[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase.from("transactions").select("*");
    if (query.from) q = q.gte("date", query.from);
    if (query.to) q = q.lte("date", query.to);
    if (query.accountId) q = q.eq("account_id", query.accountId);
    const { data, error } = await q
      .order("date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    rows.push(...data.map(toTransaction));
    if (data.length < PAGE) break;
  }
  return rows;
}

export const getRecurrences = cache(async (): Promise<Recurrence[]> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("recurrences").select("*").order("label");
  if (error) throw error;
  return data.map(toRecurrence);
});

export const getForecastItems = cache(async (): Promise<ForecastItem[]> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("forecast_items").select("*").order("date");
  if (error) throw error;
  return data.map(toForecastItem);
});

export const getGoals = cache(async (): Promise<Goal[]> => {
  const { supabase } = await getSession();
  const { data, error } = await supabase.from("goals").select("*").order("target_date");
  if (error) throw error;
  return data.map(toGoal);
});

/** Données communes à toutes les pages de l'application (layout). */
export const getAppData = cache(async () => {
  // Le profil d'abord : sa création initialise aussi comptes et catégories.
  const profile = await getProfile();
  const [accounts, categories, balances, placeMemory, recurrences, forecastItems] = await Promise.all([
    getAccounts(),
    getCategories(),
    getBalances(),
    getPlaceMemory(),
    getRecurrences(),
    getForecastItems(),
  ]);
  return { profile, accounts, categories, balances, placeMemory, recurrences, forecastItems };
});

/** Idem, sérialisable pour les composants clients (Map → objet). */
export const getClientAppData = cache(async () => {
  const { profile, accounts, categories, balances, placeMemory, recurrences, forecastItems } = await getAppData();
  return {
    profile,
    accounts,
    categories,
    balances: Object.fromEntries([...balances].map(([id, b]) => [id, b.balanceCents])),
    placeMemory,
    recurrences,
    // seules les dépenses prévues non liées servent au rapprochement de la saisie
    forecastItems: forecastItems.filter((f) => f.status === "planned"),
  };
});
