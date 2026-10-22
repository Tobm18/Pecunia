"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, gte, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema as s } from "@/lib/db";
import { isValidIsoDate, monthKeyOf, monthPeriod } from "@/lib/domain/dates";
import { seriesDates } from "@/lib/domain/forecast";
import { parseAmountToCents } from "@/lib/domain/money";
import { signedRecurrenceCents } from "@/lib/domain/recurrences";
import { getAccounts, getCategories, getProfile, getRecurrences, getSession } from "./queries";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const GENERIC_ERROR = "Enregistrement impossible, réessaie dans un instant.";
const DELETE_ERROR = "Suppression impossible, réessaie dans un instant.";
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

/** Exécute une écriture ; true si elle a réussi. */
async function attempt(write: () => Promise<unknown>): Promise<boolean> {
  try {
    await write();
    return true;
  } catch {
    return false;
  }
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

type RecurrenceRow = Omit<typeof s.recurrences.$inferInsert, "id" | "user_id" | "created_at">;

async function validateRecurrence(input: RecurrenceInput): Promise<ActionResult<RecurrenceRow>> {
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
  const { user } = await getSession();
  const r = s.recurrences;
  const saved = await attempt(() =>
    id
      ? db.update(r).set(validated.data).where(and(eq(r.id, id), eq(r.user_id, user.id)))
      : db.insert(r).values({ ...validated.data, user_id: user.id }),
  );
  if (!saved) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Supprime une récurrence ; les transactions déjà réalisées restent (lien remis à vide). */
export async function deleteRecurrence(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const r = s.recurrences;
  if (!(await attempt(() => db.delete(r).where(and(eq(r.id, id), eq(r.user_id, user.id)))))) return fail(DELETE_ERROR);
  refresh();
  return ok(undefined);
}

/**
 * Bascule d'une échéance : « réalisée » crée la transaction (liée à la récurrence, montant
 * attendu, date d'échéance) ; repasser à « prévue » supprime la transaction liée.
 */
export async function setOccurrenceDone(recurrenceId: string, date: string, done: boolean, transactionId: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(recurrenceId).success || !isValidIsoDate(date)) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const t = s.transactions;

  if (!done) {
    if (!transactionId || !uuid.safeParse(transactionId).success) return fail(GENERIC_ERROR);
    const [found] = await db
      .select({ id: t.id, transfer_id: t.transfer_id, recurrence_id: t.recurrence_id })
      .from(t)
      .where(and(eq(t.id, transactionId), eq(t.user_id, user.id)));
    if (!found) return ok(undefined);
    if (found.recurrence_id !== recurrenceId) {
      // transaction reconnue automatiquement (saisie à la main) : on ne la supprime pas
      return fail("Cette échéance correspond à une transaction saisie : modifie-la depuis Transactions.");
    }
    const target = found.transfer_id ? eq(t.transfer_id, found.transfer_id) : eq(t.id, found.id);
    if (!(await attempt(() => db.delete(t).where(and(target, eq(t.user_id, user.id)))))) {
      return fail("Modification impossible, réessaie dans un instant.");
    }
    refresh();
    return ok(undefined);
  }

  const r = (await getRecurrences()).find((x) => x.id === recurrenceId);
  if (!r) return fail("Récurrence introuvable.");
  const base = { user_id: user.id, date, place: r.label, recurrence_id: r.id, note: null };
  const rows: (typeof t.$inferInsert)[] =
    r.type === "transfer"
      ? (() => {
          const transferId = crypto.randomUUID();
          return [
            { ...base, type: "transfer", account_id: r.accountId, counterpart_account_id: r.toAccountId, amount_cents: -r.amountCents, transfer_id: transferId, category_id: null },
            { ...base, type: "transfer", account_id: r.toAccountId!, counterpart_account_id: r.accountId, amount_cents: r.amountCents, transfer_id: transferId, category_id: null },
          ];
        })()
      : [{ ...base, type: r.type, account_id: r.accountId, amount_cents: signedRecurrenceCents(r), category_id: r.categoryId }];
  if (!(await attempt(() => db.insert(t).values(rows)))) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Prévisionnel : décisions sur les propositions
// ---------------------------------------------------------------------------

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const sourceKey = z.string().regex(new RegExp(`^(rec:${UUID}:\\d{4}-\\d{2}-\\d{2}|bud:${UUID}:\\d{4}-\\d{2})$`, "i"));
const monthKey = z.string().regex(/^\d{4}-\d{2}$/);

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
  const { user } = await getSession();
  const rows: (typeof s.forecastDecisions.$inferInsert)[] = [];
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
      user_id: user.id,
      source_key: v.sourceKey,
      month: v.month,
      status: v.status,
      amount_cents: v.status === "accepted" ? amountCents : null,
      date: v.status === "accepted" ? (v.date ?? null) : null,
      account_id: v.status === "accepted" ? (v.accountId ?? null) : null,
      updated_at: new Date(),
    });
  }
  const d = s.forecastDecisions;
  const saved = await attempt(() =>
    db
      .insert(d)
      .values(rows)
      .onConflictDoUpdate({
        target: [d.user_id, d.source_key],
        set: {
          month: sql`excluded.month`,
          status: sql`excluded.status`,
          amount_cents: sql`excluded.amount_cents`,
          date: sql`excluded.date`,
          account_id: sql`excluded.account_id`,
          updated_at: sql`excluded.updated_at`,
        },
      }),
  );
  if (!saved) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Annule une décision : la proposition redevient « à valider ». */
export async function resetProposal(key: string): Promise<ActionResult> {
  if (!sourceKey.safeParse(key).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const d = s.forecastDecisions;
  if (!(await attempt(() => db.delete(d).where(and(eq(d.source_key, key), eq(d.user_id, user.id)))))) return fail(GENERIC_ERROR);
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
  const { user } = await getSession();
  const seriesId = months > 1 ? crypto.randomUUID() : null;
  const saved = await attempt(() =>
    db.insert(s.forecastItems).values(
      seriesDates(v.date, months).map((date) => ({
        user_id: user.id,
        account_id: v.accountId,
        label: v.label,
        amount_cents: cents,
        date,
        status: "planned" as const,
        series_id: seriesId,
        to_account_id: toAccountId,
      })),
    ),
  );
  if (!saved) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function updateForecastItem(id: string, input: z.input<typeof plannedSchema>): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const validated = await validatePlanned(input);
  if (!validated.ok) return validated;
  const { v, cents, toAccountId } = validated.data;
  const { user } = await getSession();
  const f = s.forecastItems;
  const saved = await attempt(() =>
    db
      .update(f)
      .set({ label: v.label, amount_cents: cents, date: v.date, account_id: v.accountId, to_account_id: toAccountId })
      .where(and(eq(f.id, id), eq(f.user_id, user.id))),
  );
  if (!saved) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

/** Supprime une ligne prévue, ou toute sa série à partir de ce mois. */
export async function deleteForecastItem(id: string, wholeSeries = false): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const f = s.forecastItems;
  const mine = eq(f.user_id, user.id);
  const deleted = await attempt(async () => {
    const [item] = wholeSeries
      ? await db.select({ series_id: f.series_id, date: f.date }).from(f).where(and(eq(f.id, id), mine))
      : [];
    if (item?.series_id) {
      await db.delete(f).where(and(mine, eq(f.series_id, item.series_id), eq(f.status, "planned"), gte(f.date, item.date)));
    } else {
      await db.delete(f).where(and(mine, eq(f.id, id)));
    }
  });
  if (!deleted) return fail(DELETE_ERROR);
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
  const { user } = await getSession();
  const g = s.goals;
  const row = { account_id: v.accountId, name: v.name, target_cents: cents, target_date: v.targetDate };
  const saved = await attempt(() =>
    id ? db.update(g).set(row).where(and(eq(g.id, id), eq(g.user_id, user.id))) : db.insert(g).values({ ...row, user_id: user.id }),
  );
  if (!saved) return fail(GENERIC_ERROR);
  refresh();
  return ok(undefined);
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return fail(GENERIC_ERROR);
  const { user } = await getSession();
  const g = s.goals;
  if (!(await attempt(() => db.delete(g).where(and(eq(g.id, id), eq(g.user_id, user.id)))))) return fail(DELETE_ERROR);
  refresh();
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Suppression du compte utilisateur
// ---------------------------------------------------------------------------

/**
 * Efface définitivement le compte : supprimer l'utilisateur efface en cascade toutes ses
 * données (clés étrangères on delete cascade). Confirmation : l'adresse email ou « SUPPRIMER ».
 */
export async function deleteMyAccount(confirmation: string): Promise<ActionResult> {
  const profile = await getProfile();
  const typed = confirmation.trim();
  if (typed !== "SUPPRIMER" && typed.toLowerCase() !== profile.email.toLowerCase()) {
    return fail("La confirmation ne correspond pas.");
  }
  const { user } = await getSession();
  if (!(await attempt(() => db.delete(s.user).where(eq(s.user.id, user.id))))) return fail(DELETE_ERROR);
  // la session a disparu avec l'utilisateur : on efface aussi le cookie
  await auth.api.signOut({ headers: await headers() }).catch(() => undefined);
  redirect("/login");
}
