"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { dedupeKey, type ExistingLine, type ImportItem } from "@/lib/domain/csv-import";
import { isValidIsoDate } from "@/lib/domain/dates";
import type { Transaction } from "@/lib/domain/types";
import { autoCategorize } from "./categorize";
import { getAccounts, getCategories, getSession, getTransactions } from "./queries";
import { toTransaction, transactionToRow } from "./mappers";

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
    categoryManual: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("transfer"),
    accountId: uuid,
    toAccountId: uuid,
    date: isoDate,
    place: text,
    amountCents: cents,
    note: text.nullable(),
    linkId: uuid.nullable().optional(),
  }),
]);

const payloadSchema = z.object({
  items: z.array(itemSchema).min(1).max(20_000),
  openingBalances: z.array(z.object({ accountId: uuid, cents: z.number().int(), date: isoDate })).max(50),
});

export type ImportPayload = { items: ImportItem[]; openingBalances: { accountId: string; cents: number; date: string }[] };
export type ImportResult =
  | { ok: true; inserted: number; skipped: number; linked: number; balancesUpdated: number }
  | { ok: false; error: string };

type NewRow = Omit<Transaction, "id" | "createdAt" | "recurrenceId">;

function rowsFor(item: ImportItem, transferId: string): NewRow[] {
  const note = item.note || null;
  if (item.kind === "transfer") {
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
      // catégorie changée à la main dans l'aperçu : manuelle ; sinon devinée, reprise par le classement automatique
      categorySource: item.kind !== "interest" && item.categoryManual ? "manual" : null,
    },
  ];
}

const CHUNK = 500;

/**
 * Virements découpés (part loyer détachée) recomposés : comparés à un relevé, ils doivent avoir
 * leur montant d'origine, sinon ils ne seraient plus reconnus comme déjà enregistrés.
 */
function foldSplits(txs: Transaction[]): Transaction[] {
  const parts = new Map<string, number>();
  for (const t of txs) if (t.splitOf) parts.set(t.splitOf, (parts.get(t.splitOf) ?? 0) + t.amountCents);
  return txs.filter((t) => !t.splitOf).map((t) => (parts.has(t.id) ? { ...t, amountCents: t.amountCents + parts.get(t.id)! } : t));
}

/**
 * Lignes enregistrées (tous comptes) sur une période : repérage des doublons sur le compte
 * importé et des mouvements à relier sur les autres comptes.
 */
export async function getLinesInRange(from: string, to: string): Promise<ExistingLine[]> {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return [];
  // marge de 3 jours : un virement peut être daté du jour de l'autre compte
  const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const txs = foldSplits(await getTransactions({ from: shift(from, -3), to: shift(to, 3) }));
  return txs.map((t) => ({
    id: t.id,
    accountId: t.accountId,
    date: t.date,
    amountCents: t.amountCents,
    type: t.type,
    place: t.place,
    counterpartAccountId: t.counterpartAccountId,
  }));
}

/**
 * Importe un lot de transactions issu d'un CSV (un compte).
 * Un virement relié à une ligne existante de l'autre compte (linkId) ne crée que la ligne
 * du compte importé et convertit la ligne existante en l'autre moitié du virement.
 * Les lignes déjà présentes (même compte, date, montant et libellé) sont ignorées : un
 * import relancé ou interrompu peut être refait sans créer de doublons.
 */
export async function importTransactions(input: ImportPayload): Promise<ImportResult> {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Le fichier contient des valeurs inattendues. Vérifie la correspondance des colonnes." };
  const { items, openingBalances } = parsed.data as ImportPayload;

  const { user } = await getSession();
  const t = s.transactions;
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

  // Lignes existantes à convertir en moitié de virement (entrée/sortie déjà saisie sur l'autre compte)
  const linkIds = items.flatMap((i) => (i.kind === "transfer" && i.linkId ? [i.linkId] : []));
  if (new Set(linkIds).size !== linkIds.length) return { ok: false, error: "Une même ligne est reliée à deux virements. Recharge la page." };
  const linked = new Map<string, Transaction>();
  for (let i = 0; i < linkIds.length; i += 200) {
    const data = await db
      .select()
      .from(t)
      .where(and(eq(t.user_id, user.id), inArray(t.id, linkIds.slice(i, i + 200))));
    for (const r of data) linked.set(r.id, toTransaction(r));
  }
  for (const item of items) {
    if (item.kind !== "transfer" || !item.linkId) continue;
    const l = linked.get(item.linkId);
    const expected = l?.accountId === item.accountId ? -item.amountCents : item.amountCents;
    const valid =
      l &&
      (l.type === "in" || l.type === "out") &&
      !l.transferId &&
      (l.accountId === item.accountId || l.accountId === item.toAccountId) &&
      l.amountCents === expected;
    if (!valid) return { ok: false, error: "Une ligne à relier a changé depuis l'ouverture du fichier. Recharge le fichier." };
  }

  // Doublons : lignes existantes sur la même période, comptées (deux achats identiques le même jour restent possibles)
  const dates = items.map((i) => i.date).sort();
  const existing = foldSplits(await getTransactions({ from: dates[0], to: dates[dates.length - 1] }));
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
  const conversions: { id: string; transferId: string; counterpartAccountId: string }[] = [];
  let skipped = 0;
  for (const item of items) {
    const transferId = crypto.randomUUID();
    let itemRows = rowsFor(item, transferId);
    const link = item.kind === "transfer" && item.linkId ? linked.get(item.linkId) : undefined;
    if (link) {
      // l'autre moitié existe déjà : on ne crée que la ligne du compte importé
      itemRows = itemRows.filter((r) => r.accountId !== link.accountId);
    }
    // ignoré si la ligne (source pour un virement) existe déjà à l'identique
    if (take(itemRows[0]!)) {
      if (itemRows[1]) take(itemRows[1]);
      skipped++;
      continue;
    }
    rows.push(...itemRows);
    if (link) conversions.push({ id: link.id, transferId, counterpartAccountId: itemRows[0]!.accountId });
  }

  // Tout ou rien : une erreur en cours de route annule l'import entier.
  let converted = 0;
  let balancesUpdated = 0;
  try {
    await db.transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx.insert(t).values(rows.slice(i, i + CHUNK).map((r) => transactionToRow(r, user.id)));
      }
      for (const c of conversions) {
        const updated = await tx
          .update(t)
          .set({ type: "transfer", transfer_id: c.transferId, counterpart_account_id: c.counterpartAccountId, category_id: null })
          .where(and(eq(t.id, c.id), eq(t.user_id, user.id), isNull(t.transfer_id)))
          .returning({ id: t.id });
        converted += updated.length;
      }
      for (const b of openingBalances) {
        if (!activeAccounts.has(b.accountId)) continue;
        const updated = await tx
          .update(s.accounts)
          .set({ initial_balance_cents: b.cents, initial_balance_date: b.date })
          .where(and(eq(s.accounts.id, b.accountId), eq(s.accounts.user_id, user.id)))
          .returning({ id: s.accounts.id });
        balancesUpdated += updated.length;
      }
    });
  } catch {
    return { ok: false, error: "Import impossible, réessaie dans un instant. Aucune ligne n'a été enregistrée." };
  }

  // classement automatique des lignes importées (annuaire des entreprises compris), après la réponse
  after(() => autoCategorize(user.id).catch(() => undefined));
  revalidatePath("/", "layout");
  return { ok: true, inserted: items.length - skipped, skipped, linked: converted, balancesUpdated };
}
