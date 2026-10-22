import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema as s } from "@/lib/db";
import { DEFAULT_ACCOUNT, DEFAULT_CATEGORIES } from "@/lib/domain/defaults";
import type { Account, Budget, Category, ForecastDecision, ForecastItem, Goal, PlaceMemoryEntry, Profile, Recurrence, Transaction, Wish } from "@/lib/domain/types";
import { toAccount, toBudget, toCategory, toForecastDecision, toForecastItem, toGoal, toPlaceMemory, toProfile, toRecurrence, toTransaction, toWish } from "./mappers";

/**
 * Couche de lecture côté serveur. Pas de RLS : chaque requête filtre explicitement sur
 * l'utilisateur de la session (user_id), y compris dans actions.ts et planning-actions.ts.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

// Utilisateur désigné par une route d'intégration (clé d'API vérifiée), à la place du cookie
const actingUser = new AsyncLocalStorage<SessionUser>();

/**
 * Exécute `fn` au nom de `user`, authentifié autrement que par le cookie de session (clé d'API
 * vérifiée avec ses permissions). Réservé aux routes de src/app/api/integrations : rien côté
 * navigateur ne peut l'atteindre, et une clé d'API ne crée jamais de session.
 */
export function runAsUser<T>(user: SessionUser, fn: () => Promise<T>): Promise<T> {
  return actingUser.run(user, fn);
}

export const getSession = cache(async (): Promise<{ user: SessionUser }> => {
  const acting = actingUser.getStore();
  if (acting) return { user: acting };
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  const { id, email, name } = session.user;
  return { user: { id, email, name } };
});

/** Code d'erreur Postgres (23505 = violation d'unicité), y compris quand Drizzle l'enveloppe. */
export function pgErrorCode(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** Crée le profil, les catégories par défaut et un premier compte à la 1re connexion. */
async function initializeUser(): Promise<void> {
  const { user } = await getSession();
  await db.transaction(async (tx) => {
    // Course entre deux requêtes parallèles : si le profil existe déjà, rien à faire.
    const created = await tx
      .insert(s.profiles)
      .values({ id: user.id, email: user.email, display_name: user.name.trim() || null })
      .onConflictDoNothing()
      .returning({ id: s.profiles.id });
    if (created.length === 0) return;
    await tx.insert(s.categories).values(
      DEFAULT_CATEGORIES.map((c, i) => ({
        user_id: user.id,
        name: c.name,
        icon: c.icon,
        color: c.color,
        is_income: c.isIncome ?? false,
        sort_order: i,
      })),
    );
    await tx.insert(s.accounts).values({
      user_id: user.id,
      name: DEFAULT_ACCOUNT.name,
      type: DEFAULT_ACCOUNT.type,
      icon: DEFAULT_ACCOUNT.icon,
      color: DEFAULT_ACCOUNT.color,
      in_budget: true,
      initial_balance_date: new Date().toISOString().slice(0, 10),
    });
  });
}

export const getProfile = cache(async (): Promise<Profile> => {
  const { user } = await getSession();
  const find = () => db.select().from(s.profiles).where(eq(s.profiles.id, user.id));
  const [row] = await find();
  if (row) return toProfile(row);
  await initializeUser();
  const [created] = await find();
  if (!created) throw new Error("Profil introuvable après initialisation.");
  return toProfile(created);
});

export const getAccounts = cache(async (): Promise<Account[]> => {
  const { user } = await getSession();
  const rows = await db
    .select()
    .from(s.accounts)
    .where(eq(s.accounts.user_id, user.id))
    .orderBy(asc(s.accounts.sort_order), asc(s.accounts.created_at));
  return rows.map(toAccount);
});

export const getCategories = cache(async (): Promise<Category[]> => {
  const { user } = await getSession();
  const rows = await db
    .select()
    .from(s.categories)
    .where(eq(s.categories.user_id, user.id))
    .orderBy(asc(s.categories.sort_order), asc(s.categories.created_at));
  return rows.map(toCategory);
});

export const getBudgets = cache(async (): Promise<Budget[]> => {
  const { user } = await getSession();
  const rows = await db.select().from(s.budgets).where(eq(s.budgets.user_id, user.id));
  return rows.map(toBudget);
});

/** Solde courant et nombre de transactions par compte. */
export const getBalances = cache(async (): Promise<Map<string, { balanceCents: number; count: number }>> => {
  const { user } = await getSession();
  const rows = await db.select().from(s.accountBalances).where(eq(s.accountBalances.user_id, user.id));
  return new Map(rows.map((r) => [r.account_id, { balanceCents: Number(r.balance_cents), count: Number(r.transaction_count) }]));
});

export const getPlaceMemory = cache(async (): Promise<PlaceMemoryEntry[]> => {
  const { user } = await getSession();
  const rows = await db
    .select()
    .from(s.placeMemory)
    .where(eq(s.placeMemory.user_id, user.id))
    .orderBy(desc(s.placeMemory.last_used));
  return rows.map(toPlaceMemory);
});

export interface TransactionQuery {
  from?: string;
  to?: string;
  accountId?: string | null;
}

/** Transactions d'une période (bornes incluses), les plus récentes d'abord. */
export async function getTransactions(query: TransactionQuery = {}): Promise<Transaction[]> {
  const { user } = await getSession();
  const t = s.transactions;
  const rows = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.user_id, user.id),
        query.from ? gte(t.date, query.from) : undefined,
        query.to ? lte(t.date, query.to) : undefined,
        query.accountId ? eq(t.account_id, query.accountId) : undefined,
      ),
    )
    .orderBy(desc(t.date), desc(t.created_at));
  return rows.map(toTransaction);
}

export const getRecurrences = cache(async (): Promise<Recurrence[]> => {
  const { user } = await getSession();
  const rows = await db.select().from(s.recurrences).where(eq(s.recurrences.user_id, user.id)).orderBy(asc(s.recurrences.label));
  return rows.map(toRecurrence);
});

export const getForecastItems = cache(async (): Promise<ForecastItem[]> => {
  const { user } = await getSession();
  const rows = await db.select().from(s.forecastItems).where(eq(s.forecastItems.user_id, user.id)).orderBy(asc(s.forecastItems.date));
  return rows.map(toForecastItem);
});

export const getForecastDecisions = cache(async (fromMonth?: string): Promise<ForecastDecision[]> => {
  const { user } = await getSession();
  const d = s.forecastDecisions;
  const rows = await db
    .select()
    .from(d)
    .where(and(eq(d.user_id, user.id), fromMonth ? gte(d.month, fromMonth) : undefined));
  return rows.map(toForecastDecision);
});

export const getWishes = cache(async (): Promise<Wish[]> => {
  const { user } = await getSession();
  const rows = await db.select().from(s.wishes).where(eq(s.wishes.user_id, user.id)).orderBy(asc(s.wishes.created_at));
  return rows.map(toWish);
});

export const getGoals = cache(async (): Promise<Goal[]> => {
  const { user } = await getSession();
  const rows = await db.select().from(s.goals).where(eq(s.goals.user_id, user.id)).orderBy(asc(s.goals.target_date));
  return rows.map(toGoal);
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
