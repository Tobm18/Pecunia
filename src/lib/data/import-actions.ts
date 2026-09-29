"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dedupeKey, type ExistingLine, type ImportItem } from "@/lib/domain/csv-import";
import { isValidIsoDate } from "@/lib/domain/dates";
import type { Transaction } from "@/lib/domain/types";
import { getAccounts, getCategories, getSession, getTransactions } from "./queries";
import { transactionToRow } from "./mappers";

const isoDate = z.string().refine(isValidIsoDate);
const uuid = z.string().uuid();
const cents = z.number().int().positive().max(1_000_000_000_00);
const text = z.string().trim().max(200);

const itemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.enum(["out", "in", "interest"]),
    accountId: uuid,
    date: isoDate,
    place: text,
    categoryId: uuid.nullable(),
    amountCents: cents,
    note: text.nullable(),
  }),
  z.object({
    kind: z.literal("transfer"),
    accountId: uuid,
    toAccountId: uuid,
    date: isoDate,
    place: text,
    amountCents: cents,
    note: text.nullable(),
  }),
]);

const payloadSchema = z.object({
  items: z.array(itemSchema).min(1).max(20_000),
  openingBalances: z.array(z.object({ accountId: uuid, cents: z.number().int(), date: isoDate })).max(50),
});

export type ImportPayload = { items: ImportItem[]; openingBalances: { accountId: string; cents: number; date: string }[] };
export type ImportResult =
  | { ok: true; inserted: number; skipped: number; balancesUpdated: number }
  | { ok: false; error: string };

type NewRow = Omit<Transaction, "id" | "createdAt" | "recurrenceId">;

function rowsFor(item: ImportItem): NewRow[] {
  const note = item.note || null;
  if (item.kind === "transfer") {
    const transferId = crypto.randomUUID();
    const common = { type: "transfer" as const, date: item.date, place: item.place || "Virement", categoryId: null, note, transferId };
    return [
      { ...common, accountId: item.accountId, counterpartAccountId: item.toAccountId, amountCents: -item.amountCents },
      { ...common, accountId: item.toAccountId, counterpartAccountId: item.accountId, amountCents: item.amountCents },
    ];
  }
  return [
    {
      type: item.kind,
      accountId: item.accountId,
      amountCents: item.kind === "out" ? -item.amountCents : item.amountCents,
      date: item.date,
      place: item.place || "Sans libellé",
      categoryId: item.kind === "interest" ? null : item.categoryId,
      note,
      counterpartAccountId: null,
      transferId: null,
    },
  ];
}

const CHUNK = 500;

/** Lignes déjà enregistrées sur un compte pour une période (repérage des doublons dans le tableau). */
export async function getExistingLines(accountId: string, from: string, to: string): Promise<ExistingLine[]> {
  if (!uuid.safeParse(accountId).success || !isValidIsoDate(from) || !isValidIsoDate(to)) return [];
  // marge de 3 jours : un virement peut être daté du jour de l'autre compte
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const txs = await getTransactions({ accountId, from: shift(from, -3), to: shift(to, 3) });
  return txs.map((t) => ({
    id: t.id,
    date: t.date,
    amountCents: t.amountCents,
    type: t.type,
    place: t.place,
    counterpartAccountId: t.counterpartAccountId,
  }));
}

/**
 * Importe un lot de transactions issu d'un ou plusieurs CSV.
 * Les lignes déjà présentes (même compte, date, montant et libellé) sont ignorées : un
 * import relancé ou interrompu peut être refait sans créer de doublons.
 */
export async function importTransactions(input: ImportPayload): Promise<ImportResult> {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Le fichier contient des valeurs inattendues. Vérifie la correspondance des colonnes." };
  const { items, openingBalances } = parsed.data as ImportPayload;

  const { supabase, user } = await getSession();
  const [accounts, categories] = await Promise.all([getAccounts(), getCategories()]);
  const activeAccounts = new Set(accounts.filter((a) => !a.archivedAt).map((a) => a.id));
  const knownCategories = new Set(categories.map((c) => c.id));
  for (const item of items) {
    if (!activeAccounts.has(item.accountId) || (item.kind === "transfer" && !activeAccounts.has(item.toAccountId))) {
      return { ok: false, error: "Un des comptes choisis n'existe plus. Recharge la page." };
    }
    if (item.kind === "transfer" && item.accountId === item.toAccountId) {
      return { ok: false, error: "Un virement relie le même compte des deux côtés." };
    }
    if (item.kind !== "transfer" && item.categoryId && !knownCategories.has(item.categoryId)) {
      return { ok: false, error: "Une des catégories choisies n'existe plus. Recharge la page." };
    }
  }

  // Doublons : lignes existantes sur la même période, comptées (deux achats identiques le même jour restent possibles)
  const dates = items.map((i) => i.date).sort();
  const existing = await getTransactions({ from: dates[0], to: dates[dates.length - 1] });
  const counts = new Map<string, number>();
  for (const t of existing) {
    const key = dedupeKey(t.accountId, t.date, t.amountCents, t.place);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const take = (row: NewRow) => {
    const key = dedupeKey(row.accountId, row.date, row.amountCents, row.place);
    const n = counts.get(key) ?? 0;
    if (n > 0) counts.set(key, n - 1);
    return n > 0;
  };

  const rows: NewRow[] = [];
  let skipped = 0;
  for (const item of items) {
    const itemRows = rowsFor(item);
    // un virement est ignoré si sa ligne source existe déjà
    if (take(itemRows[0]!)) {
      if (itemRows[1]) take(itemRows[1]);
      skipped++;
      continue;
    }
    rows.push(...itemRows);
  }

  let insertedRows = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("transactions").insert(chunk.map((r) => transactionToRow(r, user.id)));
    if (error) {
      revalidatePath("/", "layout");
      return {
        ok: false,
        error:
          insertedRows > 0
            ? "Import interrompu en cours de route. Relance-le : les lignes déjà importées seront ignorées."
            : "Import impossible, réessaie dans un instant.",
      };
    }
    insertedRows += chunk.length;
  }

  let balancesUpdated = 0;
  for (const b of openingBalances) {
    if (!activeAccounts.has(b.accountId)) continue;
    const { error } = await supabase
      .from("accounts")
      .update({ initial_balance_cents: b.cents, initial_balance_date: b.date })
      .eq("id", b.accountId);
    if (!error) balancesUpdated++;
  }

  revalidatePath("/", "layout");
  return { ok: true, inserted: items.length - skipped, skipped, balancesUpdated };
}
