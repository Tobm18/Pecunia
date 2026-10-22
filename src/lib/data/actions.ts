"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema as s } from "@/lib/db";
import { buildEntry, adjustmentCents, type EntryInput } from "@/lib/domain/entries";
import { categorySpentCents, crossedThreshold, effectiveBudgetCents } from "@/lib/domain/budgets";
import { isValidIsoDate, monthKeyOf, monthPeriod } from "@/lib/domain/dates";
import { parseAmountToCents, formatCents } from "@/lib/domain/money";
import { defaultInBudget } from "@/lib/domain/defaults";
import type { Transaction } from "@/lib/domain/types";
import { getAccounts, getBalances, getBudgets, getCategories, getProfile, getSession, getTransactions, pgErrorCode } from "./queries";
import { transactionToRow } from "./mappers";
import { refreshInternalAccounts } from "./bank";
import { THEME_COOKIE } from "@/lib/theme";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = "Enregistrement impossible, réessaie dans un instant.";
const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

function refresh() {
  revalidatePath("/", "layout");
}

const isoDate = z.string().refine(isValidIsoDate, "Date invalide.");
const uuid = z.string().uuid();

/**
 * UPDATE d'un compte ou d'une catégorie de l'utilisateur connecté. Renvoie null si une ligne
 * a été modifiée, l'erreur Postgres sinon (false : ligne absente ou d'un autre utilisateur).
 */
async function updateOwned<T extends typeof s.accounts | typeof s.categories>(
  table: T,
  id: string,
  patch: Partial<T["$inferInsert"]>,
): Promise<unknown> {
  const { user } = await getSession();
  try {
    const updated = await db
      .update(table as typeof s.accounts)
      .set(patch as Partial<typeof s.accounts.$inferInsert>)
      .where(and(eq(table.id, id), eq(table.user_id, user.id)))
      .returning({ id: table.id });
    return updated.length === 1 ? null : false;
  } catch (error) {
    return error ?? false;
  }
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface BudgetAlert {
  categoryName: string;
  ratio: number;
  over: boolean;
}

export interface CreatedEntry {
  label: string;
  amount: string;
  accountName: string;
  budgetAlert: BudgetAlert | null;
}

/** Calcule si une nouvelle dépense fait franchir 80 % / 100 % du budget de sa catégorie. */
async function budgetAlertFor(row: Omit<Transaction, "id" | "createdAt" | "recurrenceId">): Promise<BudgetAlert | null> {
  if (row.type !== "out" || !row.categoryId) return null;
  const [profile, budgets, categories, accounts] = await Promise.all([
    getProfile(),
    getBudgets(),
    getCategories(),
    getAccounts(),
  ]);
  const budget = budgets.find((b) => b.categoryId === row.categoryId);
  const category = categories.find((c) => c.id === row.categoryId);
  if (!budget || !category) return null;
  const period = monthPeriod(monthKeyOf(row.date, profile.monthStartDay), profile.monthStartDay);
  const txs = await getTransactions({ from: period.start, to: period.end });
  const after = categorySpentCents(txs, category, accounts); // la ligne vient d'être insérée
  const counted = categorySpentCents(
    [{ ...row, id: "new", createdAt: "", recurrenceId: null }],
    category,
    accounts,
  );
  const crossing = crossedThreshold(effectiveBudgetCents(budget, profile.referenceIncomeCents), after - counted, after);
  return crossing ? { categoryName: category.name, ...crossing } : null;
}

/**
 * Crée une saisie. `linkForecastId` : dépense prévue à rapprocher (bouton « Lier ») ;
 * elle passe à « réalisée » et n'est plus comptée dans le prévisionnel.
 */
export async function createEntry(input: EntryInput, linkForecastId: string | null = null): Promise<ActionResult<CreatedEntry>> {
  const { user } = await getSession();
  const accounts = (await getAccounts()).filter((a) => !a.archivedAt);
  const built = buildEntry(input, accounts, () => crypto.randomUUID());
  if (!built.ok) return fail(built.error);

  try {
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(s.transactions)
        .values(built.rows.map((r) => transactionToRow(r, user.id)))
        .returning({ id: s.transactions.id });
      if (linkForecastId && uuid.safeParse(linkForecastId).success && inserted[0]) {
        const f = s.forecastItems;
        await tx
          .update(f)
          .set({ status: "linked", linked_transaction_id: inserted[0].id })
          .where(and(eq(f.id, linkForecastId), eq(f.user_id, user.id), eq(f.status, "planned")));
      }
    });
  } catch {
    return fail(GENERIC_ERROR);
  }

  const first = built.rows[0]!;
  const budgetAlert = await budgetAlertFor(first).catch(() => null);
  refresh();
  return ok({
    label: first.place ?? "",
    amount: formatCents(Math.abs(first.amountCents)),
    accountName: accounts.find((a) => a.id === first.accountId)?.name ?? "",
    budgetAlert,
  });
}

/** Enregistre plusieurs saisies d'un coup (saisie en lot). Les lignes invalides sont ignorées. */
export async function createEntries(inputs: EntryInput[]): Promise<ActionResult<{ count: number }>> {
  const { user } = await getSession();
  const accounts = (await getAccounts()).filter((a) => !a.archivedAt);
  let count = 0;
  const rows = inputs.flatMap((input) => {
    const built = buildEntry(input, accounts, () => crypto.randomUUID());
    if (!built.ok) return [];
    count += 1;
    return built.rows;
  });
  if (rows.length === 0) return fail("Aucune ligne complète à enregistrer.");
  try {
    await db.insert(s.transactions).values(rows.map((r) => transactionToRow(r, user.id)));
  } catch {
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok({ count });
}

/**
 * Modifie une transaction. Un virement (deux lignes) est recréé à l'identique de son
 * transfer_id ; une sortie/entrée est mise à jour en place.
 */
export async function updateTransaction(id: string, input: EntryInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const t = s.transactions;
  const [existing] = await db.select().from(t).where(and(eq(t.id, id), eq(t.user_id, user.id)));
  if (!existing) return fail("Cette transaction n'existe plus.");

  const accounts = await getAccounts();
  const usable = accounts.filter((a) => !a.archivedAt || a.id === existing.account_id || a.id === existing.counterpart_account_id);
  const built = buildEntry(input, usable, () => existing.transfer_id ?? crypto.randomUUID());
  if (!built.ok) return fail(built.error);

  const wasTransfer = existing.type === "transfer";
  const isTransfer = built.rows.length === 2;

  try {
    if (!wasTransfer && !isTransfer) {
      const row = transactionToRow(built.rows[0]!, user.id);
      // une régularisation garde son type
      const type = existing.type === "adjust" ? "adjust" : row.type;
      await db.update(t).set({ ...row, type }).where(and(eq(t.id, id), eq(t.user_id, user.id)));
    } else {
      // suppression et recréation atomiques : jamais de virement à moitié enregistré
      await db.transaction(async (tx) => {
        const target = wasTransfer ? eq(t.transfer_id, existing.transfer_id!) : eq(t.id, id);
        // une ligne venue de la banque garde sa référence : sinon la synchronisation la réimporterait en double
        const fromBank = await tx
          .select({ account_id: t.account_id, bank_ref: t.bank_ref, bank_counterparty: t.bank_counterparty })
          .from(t)
          .where(and(target, eq(t.user_id, user.id), isNotNull(t.bank_ref)));
        await tx.delete(t).where(and(target, eq(t.user_id, user.id)));
        await tx.insert(t).values(
          built.rows.map((r) => {
            const bank = fromBank.find((b) => b.account_id === r.accountId);
            return { ...transactionToRow(r, user.id), ...(bank ? { bank_ref: bank.bank_ref, bank_counterparty: bank.bank_counterparty } : {}) };
          }),
        );
      });
    }
  } catch {
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok(undefined);
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const t = s.transactions;
  try {
    const [existing] = await db
      .select({ transfer_id: t.transfer_id })
      .from(t)
      .where(and(eq(t.id, id), eq(t.user_id, user.id)));
    const target = existing?.transfer_id ? eq(t.transfer_id, existing.transfer_id) : eq(t.id, id);
    await db.delete(t).where(and(target, eq(t.user_id, user.id)));
  } catch {
    return fail("Suppression impossible, réessaie dans un instant.");
  }
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

const accountSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire."),
  type: z.enum(["current", "savings", "cash"]),
  initialBalance: z.string(),
  initialBalanceDate: isoDate,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().min(1).max(30),
  today: isoDate,
});

export async function createAccount(input: z.input<typeof accountSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = accountSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const cents = parseAmountToCents(v.initialBalance || "0");
  if (cents === null) return fail("Solde initial invalide.");
  if (v.initialBalanceDate > v.today) return fail("La date ne peut pas être dans le futur");

  const { user } = await getSession();
  const accounts = await getAccounts();
  let created: { id: string } | undefined;
  try {
    [created] = await db
      .insert(s.accounts)
      .values({
        user_id: user.id,
        name: v.name,
        type: v.type,
        initial_balance_cents: cents,
        initial_balance_date: v.initialBalanceDate,
        color: v.color,
        icon: v.icon,
        in_budget: defaultInBudget(v.type),
        sort_order: accounts.length,
      })
      .returning({ id: s.accounts.id });
  } catch {
    return fail(GENERIC_ERROR);
  }
  if (!created) return fail(GENERIC_ERROR);
  refresh();
  return ok({ id: created.id });
}

const accountUpdateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().min(1).max(30),
});

export async function updateAccount(id: string, input: z.input<typeof accountUpdateSchema>): Promise<ActionResult> {
  const parsed = accountUpdateSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return fail(parsed.error?.issues[0]?.message ?? GENERIC_ERROR);
  if ((await updateOwned(s.accounts, id, parsed.data)) !== null) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function setAccountInBudget(id: string, inBudget: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  if ((await updateOwned(s.accounts, id, { in_budget: inBudget })) !== null) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function setAccountArchived(id: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  if ((await updateOwned(s.accounts, id, { archived_at: archived ? new Date() : null })) !== null) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/**
 * Supprime définitivement un compte avec ses transactions, prévisions, récurrences et objectifs
 * (cascade en base). Sert surtout à retirer un doublon ; l'archivage garde l'historique.
 */
export async function deleteAccount(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  if (!(await getAccounts()).some((a) => a.id === id)) return fail("Ce compte n'existe plus.");
  const t = s.transactions;
  try {
    await db.transaction(async (tx) => {
      // les virements avec ce compte perdent leur moitié : de l'autre côté, ils redeviennent de
      // simples entrées / sorties (et pourront être reliés de nouveau à un autre compte)
      const halves = await tx
        .select({ transfer_id: t.transfer_id })
        .from(t)
        .where(and(eq(t.account_id, id), eq(t.user_id, user.id), isNotNull(t.transfer_id)));
      const transferIds = halves.map((h) => h.transfer_id!);
      for (let i = 0; i < transferIds.length; i += 500) {
        const chunk = transferIds.slice(i, i + 500);
        await tx
          .update(t)
          .set({ type: sql`case when ${t.amount_cents} < 0 then 'out'::transaction_type else 'in'::transaction_type end`, transfer_id: null, counterpart_account_id: null })
          .where(and(eq(t.user_id, user.id), ne(t.account_id, id), inArray(t.transfer_id, chunk)));
      }
      await tx.delete(s.accounts).where(and(eq(s.accounts.id, id), eq(s.accounts.user_id, user.id)));
    });
  } catch {
    return fail("Suppression impossible, réessaie dans un instant.");
  }
  refresh();
  return ok(undefined);
}

/**
 * Aligne le solde sur le relevé bancaire. « initial » : l'écart vient d'opérations anciennes
 * absentes (historique importé incomplet) et corrige le solde initial, placé avant la première
 * ligne : l'évolution du solde reste juste. « today » : ligne « Régularisation » datée du jour.
 */
export async function adjustBalance(
  accountId: string,
  realAmount: string,
  today: string,
  mode: "initial" | "today" = "today",
): Promise<ActionResult<{ created: boolean }>> {
  if (!uuid.safeParse(accountId).success || !isValidIsoDate(today)) return fail(GENERIC_ERROR);
  const real = parseAmountToCents(realAmount);
  if (real === null) return fail("Montant invalide.");
  const balances = await getBalances();
  const computed = balances.get(accountId)?.balanceCents;
  if (computed === undefined) return fail("Compte introuvable.");
  const diff = adjustmentCents(computed, real);
  if (diff === null) return ok({ created: false });

  const { user } = await getSession();
  if (mode === "initial") {
    const t = s.transactions;
    try {
      const [account] = await db
        .select()
        .from(s.accounts)
        .where(and(eq(s.accounts.id, accountId), eq(s.accounts.user_id, user.id)));
      if (!account) return fail("Compte introuvable.");
      if (account.reference_balance_cents !== null) {
        // compte interne : son solde initial découle du solde réel de référence, mis à jour ici
        await db.update(s.accounts).set({ reference_balance_cents: real, reference_balance_date: today }).where(eq(s.accounts.id, account.id));
        await refreshInternalAccounts(user.id);
      } else {
        const [first] = await db
          .select({ date: sql<string | null>`min(${t.date})` })
          .from(t)
          .where(and(eq(t.account_id, account.id), eq(t.user_id, user.id)));
        const firstDate = first?.date ?? null;
        await db
          .update(s.accounts)
          .set({
            initial_balance_cents: Number(account.initial_balance_cents) + diff,
            ...(firstDate && firstDate < account.initial_balance_date ? { initial_balance_date: firstDate } : {}),
          })
          .where(eq(s.accounts.id, account.id));
      }
    } catch {
      return fail(GENERIC_ERROR);
    }
    refresh();
    return ok({ created: true });
  }
  try {
    await db.insert(s.transactions).values({
      user_id: user.id,
      account_id: accountId,
      type: "adjust",
      amount_cents: diff,
      date: today,
      place: "Régularisation",
      note: "Écart avec le relevé bancaire",
    });
  } catch {
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok({ created: true });
}

// ---------------------------------------------------------------------------
// Catégories & budgets
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().min(1).max(30),
  isIncome: z.boolean(),
  restrictedAccountIds: z.array(uuid),
});

function duplicateName(error: unknown) {
  return pgErrorCode(error) === "23505";
}

export async function createCategory(input: z.input<typeof categorySchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const { user } = await getSession();
  const categories = await getCategories();
  let created: { id: string } | undefined;
  try {
    [created] = await db
      .insert(s.categories)
      .values({
        user_id: user.id,
        name: v.name,
        color: v.color,
        icon: v.icon,
        is_income: v.isIncome,
        restricted_account_ids: v.restrictedAccountIds,
        sort_order: categories.length,
      })
      .returning({ id: s.categories.id });
  } catch (error) {
    return fail(duplicateName(error) ? "Ce nom existe déjà" : GENERIC_ERROR);
  }
  if (!created) return fail(GENERIC_ERROR);
  refresh();
  return ok({ id: created.id });
}

export async function updateCategory(id: string, input: z.input<typeof categorySchema>): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return fail(parsed.error?.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  if (!v.isIncome) {
    const categories = await getCategories();
    const current = categories.find((c) => c.id === id);
    const otherIncome = categories.some((c) => c.isIncome && !c.archivedAt && c.id !== id);
    if (current?.isIncome && !otherIncome) return fail("Une catégorie de revenu doit toujours rester disponible.");
  }
  const error = await updateOwned(s.categories, id, {
    name: v.name,
    color: v.color,
    icon: v.icon,
    is_income: v.isIncome,
    restricted_account_ids: v.restrictedAccountIds,
  });
  if (duplicateName(error)) return fail("Ce nom existe déjà");
  if (error !== null) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const categories = await getCategories();
  const target = categories.find((c) => c.id === id);
  if (!target) return fail("Catégorie introuvable.");
  if (archived && target.isIncome && !categories.some((c) => c.isIncome && !c.archivedAt && c.id !== id)) {
    return fail("Une catégorie de revenu doit toujours rester disponible.");
  }
  const error = await updateOwned(s.categories, id, { archived_at: archived ? new Date() : null });
  if (duplicateName(error)) return fail("Une catégorie active porte déjà ce nom.");
  if (error !== null) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Déplace une catégorie d'un cran (ordre d'affichage dans tous les sélecteurs). */
export async function moveCategory(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const { user } = await getSession();
  const active = (await getCategories()).filter((c) => !c.archivedAt);
  const index = active.findIndex((c) => c.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= active.length) return ok(undefined);
  const reordered = [...active];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith]!, reordered[index]!];
  const c = s.categories;
  try {
    await db.transaction(async (tx) => {
      for (const [i, cat] of reordered.entries()) {
        await tx.update(c).set({ sort_order: i }).where(and(eq(c.id, cat.id), eq(c.user_id, user.id)));
      }
    });
  } catch {
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok(undefined);
}

const budgetSchema = z.object({
  categoryId: uuid,
  mode: z.enum(["fixed", "percent"]),
  amount: z.string(),
});

/** Crée, modifie ou (montant vide) supprime le budget d'une catégorie. */
export async function saveBudget(input: z.input<typeof budgetSchema>): Promise<ActionResult> {
  const parsed = budgetSchema.safeParse(input);
  if (!parsed.success) return fail(GENERIC_ERROR);
  const { categoryId, mode, amount } = parsed.data;
  const { user } = await getSession();
  const b = s.budgets;

  if (!amount.trim()) {
    try {
      await db.delete(b).where(and(eq(b.category_id, categoryId), eq(b.user_id, user.id)));
    } catch {
      return fail(GENERIC_ERROR);
    }
    refresh();
    return ok(undefined);
  }

  const cents = parseAmountToCents(amount);
  if (cents === null || cents < 0) return fail("Le montant doit être positif.");
  if (mode === "percent" && cents > 10000) return fail("Le pourcentage ne peut pas dépasser 100 %.");

  const values = { mode, amount_cents: mode === "fixed" ? cents : 0, percent: mode === "percent" ? cents / 100 : null };
  try {
    // la clé étrangère (category_id, user_id) refuse la catégorie d'un autre utilisateur
    await db
      .insert(b)
      .values({ user_id: user.id, category_id: categoryId, ...values })
      .onConflictDoUpdate({ target: b.category_id, set: values, setWhere: eq(b.user_id, user.id) });
  } catch {
    return fail(GENERIC_ERROR);
  }
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Profil / paramètres
// ---------------------------------------------------------------------------

const profileSchema = z
  .object({
    theme: z.enum(["light", "dark"]),
    monthStartDay: z.number().int().min(1).max(28),
    referenceIncome: z.string(),
    budgetCarryOver: z.boolean(),
    displayName: z.string().trim().max(60),
    wishCushion: z.string(),
  })
  .partial();

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(GENERIC_ERROR);
  const v = parsed.data;
  const patch: Partial<typeof s.profiles.$inferInsert> = {};
  if (v.theme) patch.theme = v.theme;
  if (v.monthStartDay) patch.month_start_day = v.monthStartDay;
  if (v.budgetCarryOver !== undefined) patch.budget_carry_over = v.budgetCarryOver;
  if (v.displayName !== undefined) patch.display_name = v.displayName || null;
  if (v.wishCushion !== undefined) {
    const cents = parseAmountToCents(v.wishCushion || "0");
    if (cents === null || cents < 0) return fail("Montant invalide.");
    patch.wish_cushion_cents = cents;
  }
  if (v.referenceIncome !== undefined) {
    const cents = parseAmountToCents(v.referenceIncome || "0");
    if (cents === null || cents < 0) return fail("Montant invalide.");
    patch.reference_income_cents = cents;
  }
  const { user } = await getSession();
  if (Object.keys(patch).length > 0) {
    try {
      await db.update(s.profiles).set(patch).where(eq(s.profiles.id, user.id));
    } catch {
      return fail(GENERIC_ERROR);
    }
  }
  // Le thème est aussi gardé en cookie pour être appliqué dès le 1er rendu (y compris écran de connexion)
  if (v.theme) (await cookies()).set(THEME_COOKIE, v.theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  refresh();
  return ok(undefined);
}

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
