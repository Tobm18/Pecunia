"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { buildEntry, adjustmentCents, type EntryInput } from "@/lib/domain/entries";
import { categorySpentCents, crossedThreshold, effectiveBudgetCents } from "@/lib/domain/budgets";
import { isValidIsoDate, monthKeyOf, monthPeriod } from "@/lib/domain/dates";
import { parseAmountToCents, formatCents } from "@/lib/domain/money";
import { defaultInBudget } from "@/lib/domain/defaults";
import type { Transaction } from "@/lib/domain/types";
import { getAccounts, getBalances, getBudgets, getCategories, getProfile, getSession, getTransactions } from "./queries";
import { transactionToRow } from "./mappers";
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

export async function createEntry(input: EntryInput): Promise<ActionResult<CreatedEntry>> {
  const { supabase, user } = await getSession();
  const accounts = (await getAccounts()).filter((a) => !a.archivedAt);
  const built = buildEntry(input, accounts, () => crypto.randomUUID());
  if (!built.ok) return fail(built.error);

  const { error } = await supabase.from("transactions").insert(built.rows.map((r) => transactionToRow(r, user.id)));
  if (error) return fail(GENERIC_ERROR);

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
  const { supabase, user } = await getSession();
  const accounts = (await getAccounts()).filter((a) => !a.archivedAt);
  let count = 0;
  const rows = inputs.flatMap((input) => {
    const built = buildEntry(input, accounts, () => crypto.randomUUID());
    if (!built.ok) return [];
    count += 1;
    return built.rows;
  });
  if (rows.length === 0) return fail("Aucune ligne complète à enregistrer.");
  const { error } = await supabase.from("transactions").insert(rows.map((r) => transactionToRow(r, user.id)));
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok({ count });
}

/**
 * Modifie une transaction. Un virement (deux lignes) est recréé à l'identique de son
 * transfer_id ; une sortie/entrée est mise à jour en place.
 */
export async function updateTransaction(id: string, input: EntryInput): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase, user } = await getSession();
  const { data: existing, error: readError } = await supabase.from("transactions").select("*").eq("id", id).single();
  if (readError || !existing) return fail("Cette transaction n'existe plus.");

  const accounts = await getAccounts();
  const usable = accounts.filter((a) => !a.archivedAt || a.id === existing.account_id || a.id === existing.counterpart_account_id);
  const built = buildEntry(input, usable, () => existing.transfer_id ?? crypto.randomUUID());
  if (!built.ok) return fail(built.error);

  const wasTransfer = existing.type === "transfer";
  const isTransfer = built.rows.length === 2;

  if (!wasTransfer && !isTransfer) {
    const row = transactionToRow(built.rows[0]!, user.id);
    // une régularisation garde son type
    const type = existing.type === "adjust" ? "adjust" : row.type;
    const { error } = await supabase.from("transactions").update({ ...row, type }).eq("id", id);
    if (error) return fail(GENERIC_ERROR);
  } else {
    const del = wasTransfer
      ? supabase.from("transactions").delete().eq("transfer_id", existing.transfer_id)
      : supabase.from("transactions").delete().eq("id", id);
    const { error: delError } = await del;
    if (delError) return fail(GENERIC_ERROR);
    const { error } = await supabase.from("transactions").insert(built.rows.map((r) => transactionToRow(r, user.id)));
    if (error) return fail(GENERIC_ERROR);
  }
  refresh();
  return ok(undefined);
}

export async function deleteTransaction(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  const { data: existing } = await supabase.from("transactions").select("transfer_id").eq("id", id).maybeSingle();
  const query = existing?.transfer_id
    ? supabase.from("transactions").delete().eq("transfer_id", existing.transfer_id)
    : supabase.from("transactions").delete().eq("id", id);
  const { error } = await query;
  if (error) return fail("Suppression impossible, réessaie dans un instant.");
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

  const { supabase, user } = await getSession();
  const accounts = await getAccounts();
  const { data, error } = await supabase
    .from("accounts")
    .insert({
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
    .select("id")
    .single();
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok({ id: data.id as string });
}

const accountUpdateSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire."),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().min(1).max(30),
});

export async function updateAccount(id: string, input: z.input<typeof accountUpdateSchema>): Promise<ActionResult> {
  const parsed = accountUpdateSchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return fail(parsed.error?.issues[0]?.message ?? GENERIC_ERROR);
  const { supabase } = await getSession();
  const { error } = await supabase.from("accounts").update(parsed.data).eq("id", id);
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function setAccountInBudget(id: string, inBudget: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  const { error } = await supabase.from("accounts").update({ in_budget: inBudget }).eq("id", id);
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function setAccountArchived(id: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  if (archived) {
    const active = (await getAccounts()).filter((a) => !a.archivedAt);
    if (active.length <= 1) return fail("Il faut garder au moins un compte actif.");
  }
  const { error } = await supabase
    .from("accounts")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Crée une ligne « Régularisation » pour aligner le solde sur le relevé bancaire. */
export async function adjustBalance(accountId: string, realAmount: string, today: string): Promise<ActionResult<{ created: boolean }>> {
  if (!uuid.safeParse(accountId).success || !isValidIsoDate(today)) return fail(GENERIC_ERROR);
  const real = parseAmountToCents(realAmount);
  if (real === null) return fail("Montant invalide.");
  const balances = await getBalances();
  const computed = balances.get(accountId)?.balanceCents;
  if (computed === undefined) return fail("Compte introuvable.");
  const diff = adjustmentCents(computed, real);
  if (diff === null) return ok({ created: false });

  const { supabase, user } = await getSession();
  const { error } = await supabase.from("transactions").insert({
    user_id: user.id,
    account_id: accountId,
    type: "adjust",
    amount_cents: diff,
    date: today,
    place: "Régularisation",
    note: "Écart avec le relevé bancaire",
  });
  if (error) return fail(GENERIC_ERROR);
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

function duplicateName(error: { code?: string } | null) {
  return error?.code === "23505";
}

export async function createCategory(input: z.input<typeof categorySchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const { supabase, user } = await getSession();
  const categories = await getCategories();
  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: user.id,
      name: v.name,
      color: v.color,
      icon: v.icon,
      is_income: v.isIncome,
      restricted_account_ids: v.restrictedAccountIds,
      sort_order: categories.length,
    })
    .select("id")
    .single();
  if (duplicateName(error)) return fail("Ce nom existe déjà");
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok({ id: data.id as string });
}

export async function updateCategory(id: string, input: z.input<typeof categorySchema>): Promise<ActionResult> {
  const parsed = categorySchema.safeParse(input);
  if (!parsed.success || !uuid.safeParse(id).success) return fail(parsed.error?.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const { supabase } = await getSession();
  if (!v.isIncome) {
    const categories = await getCategories();
    const current = categories.find((c) => c.id === id);
    const otherIncome = categories.some((c) => c.isIncome && !c.archivedAt && c.id !== id);
    if (current?.isIncome && !otherIncome) return fail("Une catégorie de revenu doit toujours rester disponible.");
  }
  const { error } = await supabase
    .from("categories")
    .update({ name: v.name, color: v.color, icon: v.icon, is_income: v.isIncome, restricted_account_ids: v.restrictedAccountIds })
    .eq("id", id);
  if (duplicateName(error)) return fail("Ce nom existe déjà");
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function setCategoryArchived(id: string, archived: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  const categories = await getCategories();
  const target = categories.find((c) => c.id === id);
  if (!target) return fail("Catégorie introuvable.");
  if (archived && target.isIncome && !categories.some((c) => c.isIncome && !c.archivedAt && c.id !== id)) {
    return fail("Une catégorie de revenu doit toujours rester disponible.");
  }
  const { error } = await supabase
    .from("categories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (duplicateName(error)) return fail("Une catégorie active porte déjà ce nom.");
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Déplace une catégorie d'un cran (ordre d'affichage dans tous les sélecteurs). */
export async function moveCategory(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const { supabase } = await getSession();
  const active = (await getCategories()).filter((c) => !c.archivedAt);
  const index = active.findIndex((c) => c.id === id);
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapWith < 0 || swapWith >= active.length) return ok(undefined);
  const reordered = [...active];
  [reordered[index], reordered[swapWith]] = [reordered[swapWith]!, reordered[index]!];
  const results = await Promise.all(
    reordered.map((c, i) => supabase.from("categories").update({ sort_order: i }).eq("id", c.id)),
  );
  if (results.some((r) => r.error)) return fail(GENERIC_ERROR);
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
  const { supabase, user } = await getSession();

  if (!amount.trim()) {
    const { error } = await supabase.from("budgets").delete().eq("category_id", categoryId);
    if (error) return fail(GENERIC_ERROR);
    refresh();
    return ok(undefined);
  }

  const cents = parseAmountToCents(amount);
  if (cents === null || cents < 0) return fail("Le montant doit être positif.");
  if (mode === "percent" && cents > 10000) return fail("Le pourcentage ne peut pas dépasser 100 %.");

  const { error } = await supabase.from("budgets").upsert(
    {
      user_id: user.id,
      category_id: categoryId,
      mode,
      amount_cents: mode === "fixed" ? cents : 0,
      percent: mode === "percent" ? cents / 100 : null,
    },
    { onConflict: "category_id" },
  );
  if (error) return fail(GENERIC_ERROR);
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
  })
  .partial();

export async function updateProfile(input: z.input<typeof profileSchema>): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(GENERIC_ERROR);
  const v = parsed.data;
  const patch: Record<string, unknown> = {};
  if (v.theme) patch.theme = v.theme;
  if (v.monthStartDay) patch.month_start_day = v.monthStartDay;
  if (v.budgetCarryOver !== undefined) patch.budget_carry_over = v.budgetCarryOver;
  if (v.displayName !== undefined) patch.display_name = v.displayName || null;
  if (v.referenceIncome !== undefined) {
    const cents = parseAmountToCents(v.referenceIncome || "0");
    if (cents === null || cents < 0) return fail("Montant invalide.");
    patch.reference_income_cents = cents;
  }
  const { supabase, user } = await getSession();
  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) return fail(GENERIC_ERROR);
  // Le thème est aussi gardé en cookie pour être appliqué dès le 1er rendu (y compris écran de connexion)
  if (v.theme) (await cookies()).set(THEME_COOKIE, v.theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  refresh();
  return ok(undefined);
}

export async function signOut(): Promise<void> {
  const { supabase } = await getSession();
  await supabase.auth.signOut();
  redirect("/login");
}
