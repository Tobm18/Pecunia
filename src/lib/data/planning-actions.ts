"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isValidIsoDate, monthKeyOf, monthPeriod } from "@/lib/domain/dates";
import { seriesDates } from "@/lib/domain/forecast";
import { parseAmountToCents } from "@/lib/domain/money";
import { signedRecurrenceCents } from "@/lib/domain/recurrences";
import { getAccounts, getCategories, getProfile, getRecurrences, getSession } from "./queries";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = "Enregistrement impossible, réessaie dans un instant.";
const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data });
const fail = (error: string): ActionResult<never> => ({ ok: false, error });
const refresh = () => revalidatePath("/", "layout");

const uuid = z.string().uuid();
const isoDate = z.string().refine(isValidIsoDate, "Date invalide.");

/** Montant saisi (texte) → centimes strictement positifs */
function positiveCents(raw: string): number | null {
  const cents = parseAmountToCents(raw);
  return cents !== null && cents > 0 ? cents : null;
}

// ---------------------------------------------------------------------------
// Récurrences
// ---------------------------------------------------------------------------

const recurrenceSchema = z.object({
  type: z.enum(["out", "in", "transfer"]),
  label: z.string().trim().min(1, "Le libellé est obligatoire.").max(120),
  amount: z.string(),
  categoryId: uuid.nullable(),
  accountId: uuid,
  toAccountId: uuid.nullable(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  dueDay: z.number().int().min(1).max(31),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  isSubscription: z.boolean(),
});

export type RecurrenceInput = z.input<typeof recurrenceSchema>;

async function validateRecurrence(input: RecurrenceInput): Promise<ActionResult<Record<string, unknown>>> {
  const parsed = recurrenceSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const cents = positiveCents(v.amount);
  if (cents === null) return fail("Le montant doit être supérieur à zéro.");
  if (v.endDate && v.endDate < v.startDate) return fail("La date de fin ne peut pas précéder la date de début.");
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);
  if (!accounts.some((a) => a.id === v.accountId)) return fail("Compte introuvable.");
  if (v.type === "transfer") {
    if (!v.toAccountId || !accounts.some((a) => a.id === v.toAccountId)) return fail("Choisis le compte de destination.");
    if (v.toAccountId === v.accountId) return fail("Choisis deux comptes différents.");
  } else if (!v.categoryId || !categories.some((c) => c.id === v.categoryId)) {
    return fail("Choisis une catégorie.");
  }
  return ok({
    type: v.type,
    label: v.label,
    amount_cents: cents,
    category_id: v.type === "transfer" ? null : v.categoryId,
    account_id: v.accountId,
    to_account_id: v.type === "transfer" ? v.toAccountId : null,
    frequency: v.frequency,
    due_day: v.dueDay,
    start_date: v.startDate,
    end_date: v.endDate,
    is_subscription: v.type === "out" && v.isSubscription,
  });
}

export async function saveRecurrence(id: string | null, input: RecurrenceInput): Promise<ActionResult> {
  if (id && !uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const validated = await validateRecurrence(input);
  if (!validated.ok) return validated;
  const { supabase, user } = await getSession();
  const { error } = id
    ? await supabase.from("recurrences").update(validated.data).eq("id", id)
    : await supabase.from("recurrences").insert({ ...validated.data, user_id: user.id });
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Supprime une récurrence ; les transactions déjà réalisées restent (lien remis à vide). */
export async function deleteRecurrence(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  const { error } = await supabase.from("recurrences").delete().eq("id", id);
  if (error) return fail("Suppression impossible, réessaie dans un instant.");
  refresh();
  return ok(undefined);
}

/**
 * Bascule d'une échéance : « réalisée » crée la transaction (liée à la récurrence, montant
 * attendu, date d'échéance) ; repasser à « prévue » supprime la transaction liée.
 */
export async function setOccurrenceDone(recurrenceId: string, date: string, done: boolean, transactionId: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(recurrenceId).success || !isValidIsoDate(date)) return fail(GENERIC_ERROR);
  const { supabase, user } = await getSession();

  if (!done) {
    if (!transactionId || !uuid.safeParse(transactionId).success) return fail(GENERIC_ERROR);
    const { data: t } = await supabase.from("transactions").select("id, transfer_id, recurrence_id").eq("id", transactionId).maybeSingle();
    if (!t) return ok(undefined);
    if (t.recurrence_id !== recurrenceId) {
      // transaction reconnue automatiquement (saisie à la main) : on ne la supprime pas
      return fail("Cette échéance correspond à une transaction saisie : modifie-la depuis Transactions.");
    }
    const del = t.transfer_id
      ? supabase.from("transactions").delete().eq("transfer_id", t.transfer_id)
      : supabase.from("transactions").delete().eq("id", t.id);
    const { error } = await del;
    if (error) return fail("Modification impossible, réessaie dans un instant.");
    refresh();
    return ok(undefined);
  }

  const r = (await getRecurrences()).find((x) => x.id === recurrenceId);
  if (!r) return fail("Récurrence introuvable.");
  const base = { user_id: user.id, date, place: r.label, recurrence_id: r.id, note: null };
  const rows: Record<string, unknown>[] =
    r.type === "transfer"
      ? (() => {
          const transferId = crypto.randomUUID();
          return [
            { ...base, type: "transfer", account_id: r.accountId, counterpart_account_id: r.toAccountId, amount_cents: -r.amountCents, transfer_id: transferId, category_id: null },
            { ...base, type: "transfer", account_id: r.toAccountId, counterpart_account_id: r.accountId, amount_cents: r.amountCents, transfer_id: transferId, category_id: null },
          ];
        })()
      : [{ ...base, type: r.type, account_id: r.accountId, amount_cents: signedRecurrenceCents(r), category_id: r.categoryId }];
  const { error } = await supabase.from("transactions").insert(rows);
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Prévisionnel : décisions sur les propositions
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const sourceKey = z.string().regex(new RegExp(`^(rec:${UUID}:\\d{4}-\\d{2}-\\d{2}|bud:${UUID}:\\d{4}-\\d{2})$`, "i"));
const monthKey = z.string().regex(/^\d{4}-\d{2}$/);
const MISSING_TABLE = "Le prévisionnel n'est pas encore activé : exécute la migration « forecast_decisions » dans Supabase.";
const isMissingTable = (code?: string) => code === "42P01" || code === "PGRST205";

const decisionSchema = z.object({
  sourceKey,
  month: monthKey,
  status: z.enum(["accepted", "rejected"]),
  /** Modification (acceptée avec d'autres valeurs) ; vide = valeurs proposées */
  amount: z.string().nullable().optional(),
  date: isoDate.nullable().optional(),
  accountId: uuid.nullable().optional(),
});

export type DecisionInput = z.input<typeof decisionSchema>;

/** Oui / Non / Modifier sur une ou plusieurs propositions (upsert par clé). */
export async function decideProposals(inputs: DecisionInput[]): Promise<ActionResult> {
  if (inputs.length === 0 || inputs.length > 200) return fail(GENERIC_ERROR);
  const accounts = await getAccounts();
  const rows: Record<string, unknown>[] = [];
  for (const input of inputs) {
    const parsed = decisionSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
    const v = parsed.data;
    let amountCents: number | null = null;
    if (v.amount) {
      amountCents = positiveCents(v.amount);
      if (amountCents === null) return fail("Le montant doit être supérieur à zéro.");
    }
    if (v.accountId && !accounts.some((a) => a.id === v.accountId && !a.archivedAt)) return fail("Compte introuvable.");
    rows.push({
      source_key: v.sourceKey,
      month: v.month,
      status: v.status,
      amount_cents: v.status === "accepted" ? amountCents : null,
      date: v.status === "accepted" ? (v.date ?? null) : null,
      account_id: v.status === "accepted" ? (v.accountId ?? null) : null,
      updated_at: new Date().toISOString(),
    });
  }
  const { supabase, user } = await getSession();
  const { error } = await supabase
    .from("forecast_decisions")
    .upsert(rows.map((r) => ({ ...r, user_id: user.id })), { onConflict: "user_id,source_key" });
  if (error) return fail(isMissingTable(error.code) ? MISSING_TABLE : GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Annule une décision : la proposition redevient « à valider ». */
export async function resetProposal(key: string): Promise<ActionResult> {
  if (!sourceKey.safeParse(key).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  const { error } = await supabase.from("forecast_decisions").delete().eq("source_key", key);
  if (error) return fail(isMissingTable(error.code) ? MISSING_TABLE : GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Prévisionnel : lignes prévues saisies à la main (sur un ou plusieurs mois)
// ---------------------------------------------------------------------------

const plannedSchema = z.object({
  label: z.string().trim().min(1, "Le libellé est obligatoire.").max(120),
  amount: z.string(),
  direction: z.enum(["out", "in", "transfer"]),
  date: isoDate,
  accountId: uuid,
  /** Virement interne : compte crédité */
  toAccountId: uuid.nullable().optional(),
  today: isoDate,
});

const MISSING_TRANSFER_COLUMN = "Les virements prévus ne sont pas encore activés : exécute la migration « forecast_transfers » dans Supabase.";
const plannedError = (code?: string) => (code === "42703" || code === "PGRST204" ? MISSING_TRANSFER_COLUMN : GENERIC_ERROR);

async function validatePlanned(
  input: z.input<typeof plannedSchema>,
): Promise<ActionResult<{ v: z.output<typeof plannedSchema>; cents: number; toAccountId: string | null }>> {
  const parsed = plannedSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const cents = positiveCents(v.amount);
  if (cents === null) return fail("Le montant doit être supérieur à zéro.");
  const [profile, accounts] = await Promise.all([getProfile(), getAccounts()]);
  if (v.date < monthPeriod(monthKeyOf(v.today, profile.monthStartDay), profile.monthStartDay).start) {
    return fail("La date doit être dans le mois en cours ou après.");
  }
  if (!accounts.some((a) => a.id === v.accountId && !a.archivedAt)) return fail("Compte introuvable.");
  if (v.direction === "transfer") {
    if (!v.toAccountId || !accounts.some((a) => a.id === v.toAccountId && !a.archivedAt)) return fail("Choisis le compte de destination.");
    if (v.toAccountId === v.accountId) return fail("Choisis deux comptes différents.");
    return ok({ v, cents: -cents, toAccountId: v.toAccountId });
  }
  return ok({ v, cents: v.direction === "out" ? -cents : cents, toAccountId: null });
}

/** Ajoute une entrée / sortie prévue, répétée sur `months` mois (même jour, ramené à la fin du mois). */
export async function createForecastItems(input: z.input<typeof plannedSchema> & { months: number }): Promise<ActionResult> {
  const months = Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 36) return fail("Choisis entre 1 et 36 mois.");
  const validated = await validatePlanned(input);
  if (!validated.ok) return validated;
  const { v, cents, toAccountId } = validated.data;
  const { supabase, user } = await getSession();
  const seriesId = months > 1 ? crypto.randomUUID() : null;
  const { error } = await supabase.from("forecast_items").insert(
    seriesDates(v.date, months).map((date) => ({
      user_id: user.id,
      account_id: v.accountId,
      label: v.label,
      amount_cents: cents,
      date,
      status: "planned",
      ...(seriesId ? { series_id: seriesId } : {}),
      ...(toAccountId ? { to_account_id: toAccountId } : {}),
    })),
  );
  if (error) return fail(plannedError(error.code));
  refresh();
  return ok(undefined);
}

export async function updateForecastItem(id: string, input: z.input<typeof plannedSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const validated = await validatePlanned(input);
  if (!validated.ok) return validated;
  const { v, cents, toAccountId } = validated.data;
  const { supabase } = await getSession();
  const { error } = await supabase
    .from("forecast_items")
    .update({ label: v.label, amount_cents: cents, date: v.date, account_id: v.accountId, to_account_id: toAccountId })
    .eq("id", id);
  if (error) return fail(plannedError(error.code));
  refresh();
  return ok(undefined);
}

/** Supprime une ligne prévue, ou toute sa série à partir de ce mois. */
export async function deleteForecastItem(id: string, wholeSeries = false): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  let error;
  if (wholeSeries) {
    const { data: item } = await supabase.from("forecast_items").select("series_id, date").eq("id", id).maybeSingle();
    if (item?.series_id) {
      ({ error } = await supabase
        .from("forecast_items")
        .delete()
        .eq("series_id", item.series_id)
        .eq("status", "planned")
        .gte("date", item.date));
    } else {
      ({ error } = await supabase.from("forecast_items").delete().eq("id", id));
    }
  } else {
    ({ error } = await supabase.from("forecast_items").delete().eq("id", id));
  }
  if (error) return fail("Suppression impossible, réessaie dans un instant.");
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Objectifs d'épargne
// ---------------------------------------------------------------------------

const goalSchema = z.object({
  name: z.string().trim().min(1, "Le nom est obligatoire.").max(80),
  accountId: uuid,
  target: z.string(),
  targetDate: isoDate,
  today: isoDate,
});

export async function saveGoal(id: string | null, input: z.input<typeof goalSchema>): Promise<ActionResult> {
  if (id && !uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? GENERIC_ERROR);
  const v = parsed.data;
  const cents = positiveCents(v.target);
  if (cents === null) return fail("Le montant cible doit être supérieur à zéro.");
  if (v.targetDate <= v.today) return fail("La date cible doit être dans le futur.");
  if (!(await getAccounts()).some((a) => a.id === v.accountId)) return fail("Compte introuvable.");
  const { supabase, user } = await getSession();
  const row = { account_id: v.accountId, name: v.name, target_cents: cents, target_date: v.targetDate };
  const { error } = id
    ? await supabase.from("goals").update(row).eq("id", id)
    : await supabase.from("goals").insert({ ...row, user_id: user.id });
  if (error) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { supabase } = await getSession();
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) return fail("Suppression impossible, réessaie dans un instant.");
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Suppression du compte utilisateur
// ---------------------------------------------------------------------------

/**
 * Efface définitivement toutes les données puis le compte d'authentification (fonction SQL
 * delete_my_account). Confirmation : l'adresse email du compte ou « SUPPRIMER ».
 */
export async function deleteMyAccount(confirmation: string): Promise<ActionResult> {
  const profile = await getProfile();
  const typed = confirmation.trim();
  if (typed !== "SUPPRIMER" && typed.toLowerCase() !== profile.email.toLowerCase()) {
    return fail("La confirmation ne correspond pas.");
  }
  const { supabase } = await getSession();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) {
    return fail(
      error.code === "PGRST202"
        ? "La suppression n'est pas encore activée : exécute la migration « delete_account » dans Supabase."
        : "Suppression impossible, réessaie dans un instant.",
    );
  }
  await supabase.auth.signOut();
  redirect("/login");
}
