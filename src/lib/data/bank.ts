import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, schema as s } from "@/lib/db";
import { BankApiError, bankName, createSession, deleteSession, getBalances, getTransactions, isBankConfigured } from "@/lib/bank/enable-banking";
import {
  bankAccountLabel,
  findInternalAccount,
  guessAccountType,
  initialBalanceFor,
  MIN_IDENTIFIER_LENGTH,
  normalizeIdentifier,
  pickBalanceCents,
  toBankLines,
} from "@/lib/domain/bank-sync";
import { createCategorizer, INTEREST_PATTERN, normalizeText } from "@/lib/domain/csv-import";
import { todayIso } from "@/lib/domain/dates";
import { toCategory, toPlaceMemory } from "./mappers";

/**
 * Connexion bancaire (Enable Banking) : enregistrement du consentement, puis synchronisation des
 * comptes reliés. Fonctions sans session : l'utilisateur est toujours passé explicitement, car la
 * synchronisation quotidienne (cron) n'a pas de cookie. Chaque requête filtre sur user_id.
 */

const CHUNK = 500;
/** Marge de recouvrement à chaque synchronisation (écritures comptabilisées avec retard) */
const OVERLAP_DAYS = 7;
const LIMITED_HISTORY_DAYS = 90;

const shiftDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Consentement
// ---------------------------------------------------------------------------

/** Prépare une connexion en attente ; `state` revient tel quel de la banque (anti-falsification). */
export async function createPendingConnection(userId: string, state: string, validUntil: Date): Promise<void> {
  const c = s.bankConnections;
  // une autorisation jamais terminée ne sert plus à rien
  await db.delete(c).where(and(eq(c.user_id, userId), eq(c.status, "pending")));
  await db.insert(c).values({ user_id: userId, aspsp_name: bankName(), state, valid_until: validUntil, status: "pending" });
}

export type AuthorizationResult = { ok: true } | { ok: false; error: string };

/**
 * Retour de la banque : échange le code contre une session, enregistre les comptes autorisés et
 * reprend les liaisons d'une connexion précédente (même IBAN) pour ne pas tout reconfigurer à
 * chaque renouvellement du consentement.
 */
export async function completeAuthorization(userId: string, state: string, code: string): Promise<AuthorizationResult> {
  const c = s.bankConnections;
  const [pending] = await db
    .select()
    .from(c)
    .where(and(eq(c.user_id, userId), eq(c.state, state), eq(c.status, "pending")));
  if (!pending) return { ok: false, error: "Autorisation inconnue ou déjà utilisée. Relance la connexion." };

  let session;
  try {
    session = await createSession(code);
  } catch (error) {
    await db.update(c).set({ status: "error", state: null, last_error: errorText(error) }).where(eq(c.id, pending.id));
    return { ok: false, error: errorText(error) };
  }

  const validUntil = session.access?.valid_until ? new Date(session.access.valid_until) : pending.valid_until;
  const previous = await db
    .select()
    .from(s.bankAccounts)
    .where(and(eq(s.bankAccounts.user_id, userId), isNotNull(s.bankAccounts.account_id)));
  const previousSessions = await db
    .select({ id: c.id, session_id: c.session_id })
    .from(c)
    .where(and(eq(c.user_id, userId), inArray(c.status, ["active", "expired", "error"])));

  await db.transaction(async (tx) => {
    await tx.update(c).set({ state: null, session_id: session.session_id, status: "active", valid_until: validUntil, last_error: null }).where(eq(c.id, pending.id));
    if (session.accounts.length) {
      await tx.insert(s.bankAccounts).values(
        session.accounts.map((a) => {
          const iban = a.account_id?.iban ?? null;
          const name = bankAccountLabel(a, iban);
          const before = previous.find((p) => (iban && p.iban === iban) || (!iban && p.name && p.name === name));
          return {
            user_id: userId,
            connection_id: pending.id,
            uid: a.uid,
            iban,
            name,
            currency: a.currency ?? null,
            account_id: before?.account_id ?? null,
            synced_until: before?.synced_until ?? null,
          };
        }),
      );
    }
    // les anciennes connexions (consentement précédent) sont remplacées par celle-ci
    if (previousSessions.length) {
      await tx.delete(c).where(
        inArray(
          c.id,
          previousSessions.map((p) => p.id),
        ),
      );
    }
  });
  // consentements remplacés : révoqués chez Enable Banking, sans bloquer si la banque les a déjà fermés
  await Promise.all(previousSessions.map((p) => (p.session_id ? deleteSession(p.session_id).catch(() => undefined) : undefined)));
  return { ok: true };
}

/** Retrait du consentement : la connexion disparaît, les transactions déjà importées restent. */
export async function disconnectAll(userId: string): Promise<void> {
  const c = s.bankConnections;
  const connections = await db.select({ id: c.id, session_id: c.session_id }).from(c).where(eq(c.user_id, userId));
  await db.delete(c).where(eq(c.user_id, userId));
  await Promise.all(connections.map((x) => (x.session_id ? deleteSession(x.session_id).catch(() => undefined) : undefined)));
}

// ---------------------------------------------------------------------------
// Liaison avec les comptes Pecunia
// ---------------------------------------------------------------------------

/** Relie (ou délie) un compte bancaire à un compte Pecunia, existant ou créé à la volée. */
export async function linkBankAccount(userId: string, bankAccountId: string, target: string | "new" | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const ba = s.bankAccounts;
  const [bank] = await db.select().from(ba).where(and(eq(ba.id, bankAccountId), eq(ba.user_id, userId)));
  if (!bank) return { ok: false, error: "Compte bancaire introuvable." };

  let accountId: string | null = null;
  if (target === "new") {
    const [last] = await db.select({ n: s.accounts.sort_order }).from(s.accounts).where(eq(s.accounts.user_id, userId)).orderBy(desc(s.accounts.sort_order)).limit(1);
    const type = guessAccountType(bank.name);
    const [created] = await db
      .insert(s.accounts)
      .values({
        user_id: userId,
        name: (bank.name ?? "Compte bancaire").slice(0, 60),
        type,
        icon: type === "savings" ? "piggy" : "card",
        in_budget: type === "current",
        sort_order: (last?.n ?? 0) + 1,
        initial_balance_date: todayIso(),
      })
      .returning({ id: s.accounts.id });
    accountId = created!.id;
  } else if (target) {
    const [account] = await db.select({ id: s.accounts.id }).from(s.accounts).where(and(eq(s.accounts.id, target), eq(s.accounts.user_id, userId)));
    if (!account) return { ok: false, error: "Ce compte n'existe plus. Recharge la page." };
    // un compte Pecunia n'est alimenté que par un seul compte bancaire
    const [taken] = await db.select({ id: ba.id }).from(ba).where(and(eq(ba.user_id, userId), eq(ba.account_id, account.id)));
    if (taken && taken.id !== bank.id) return { ok: false, error: "Ce compte est déjà relié à un autre compte bancaire." };
    accountId = account.id;
  }
  // changer de compte cible : l'historique est à récupérer de nouveau (sans doublon grâce à bank_ref)
  await db.update(ba).set({ account_id: accountId, synced_until: accountId === bank.account_id ? bank.synced_until : null }).where(eq(ba.id, bank.id));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Synchronisation
// ---------------------------------------------------------------------------

export interface SyncSummary {
  inserted: number;
  accounts: number;
}

function errorText(error: unknown): string {
  if (error instanceof BankApiError) {
    if (error.status === 429) return "Limite d'accès de la banque atteinte, réessaie plus tard.";
    if (error.status === 401 || error.status === 403) return "L'accès à ta banque a expiré : reconnecte-la.";
    return error.message;
  }
  return "Synchronisation impossible, réessaie dans un instant.";
}

/** Écritures d'un compte, avec un historique plus court si la banque refuse la période demandée. */
async function fetchLines(uid: string, syncedUntil: string | null) {
  const today = todayIso();
  // 1re synchro : la plus longue période que la banque fournit ; ensuite, quelques jours de recouvrement
  const from = syncedUntil ? shiftDays(syncedUntil, -OVERLAP_DAYS) : null;
  try {
    return toBankLines(await getTransactions(uid, from));
  } catch (error) {
    // historique complet refusé par la banque : on se limite aux 90 derniers jours
    if (!syncedUntil && error instanceof BankApiError && (error.status === 400 || error.status === 422)) {
      return toBankLines(await getTransactions(uid, shiftDays(today, -LIMITED_HISTORY_DAYS)));
    }
    throw error;
  }
}

async function syncAccount(userId: string, bank: typeof s.bankAccounts.$inferSelect, categorizer: ReturnType<typeof createCategorizer>): Promise<number> {
  const [account] = await db
    .select()
    .from(s.accounts)
    .where(and(eq(s.accounts.id, bank.account_id!), eq(s.accounts.user_id, userId)));
  if (!account) return 0;
  const lines = await fetchLines(bank.uid, bank.synced_until);

  const t = s.transactions;
  const rows = lines.map((l) => {
    const interest = l.cents > 0 && account.type === "savings" && INTEREST_PATTERN.test(normalizeText(l.label));
    const type = l.cents < 0 ? ("out" as const) : interest ? ("interest" as const) : ("in" as const);
    return {
      user_id: userId,
      account_id: account.id,
      type,
      amount_cents: l.cents,
      date: l.date,
      place: l.label,
      category_id: type === "interest" ? null : categorizer.categoryFor(l.label, l.cents < 0 ? "out" : "in"),
      bank_ref: l.ref,
      bank_counterparty: l.counterparty,
    };
  });
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    // ligne déjà importée : seul son compte en face est complété (catégorie et corrections gardées)
    const done = await db
      .insert(t)
      .values(rows.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: [t.user_id, t.account_id, t.bank_ref],
        targetWhere: sql`${t.bank_ref} is not null`,
        set: { bank_counterparty: sql`excluded.bank_counterparty` },
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });
    inserted += done.filter((r) => r.inserted).length;
  }

  // Le solde de Pecunia suit celui de la banque : le solde initial absorbe l'historique non récupéré.
  let bankBalance: number | null = null;
  try {
    bankBalance = pickBalanceCents(await getBalances(bank.uid));
  } catch (error) {
    if (error instanceof BankApiError && (error.status === 401 || error.status === 403)) throw error;
  }
  if (bankBalance !== null) {
    const [sum] = await db
      .select({ total: sql<string>`coalesce(sum(${t.amount_cents}), 0)`, first: sql<string | null>`min(${t.date})` })
      .from(t)
      .where(and(eq(t.account_id, account.id), eq(t.user_id, userId)));
    const first = sum?.first;
    await db
      .update(s.accounts)
      .set({
        initial_balance_cents: initialBalanceFor(bankBalance, Number(sum?.total ?? 0)),
        // le solde initial précède la première ligne
        ...(first && first < account.initial_balance_date ? { initial_balance_date: first } : {}),
      })
      .where(eq(s.accounts.id, account.id));
  }
  await db.update(s.bankAccounts).set({ synced_until: todayIso(), bank_balance_cents: bankBalance }).where(eq(s.bankAccounts.id, bank.id));
  return inserted;
}

/** Synchronise les comptes reliés d'une connexion. Enregistre l'état (dernière synchro, erreur). */
export async function syncConnection(userId: string, connectionId: string): Promise<{ ok: true; summary: SyncSummary } | { ok: false; error: string }> {
  if (!isBankConfigured()) return { ok: false, error: "Connexion bancaire non configurée sur le serveur." };
  const c = s.bankConnections;
  const [conn] = await db.select().from(c).where(and(eq(c.id, connectionId), eq(c.user_id, userId)));
  if (!conn || conn.status === "pending" || !conn.session_id) return { ok: false, error: "Aucune connexion bancaire active." };
  if (conn.valid_until && conn.valid_until < new Date()) {
    const error = "L'accès à ta banque a expiré : reconnecte-la.";
    await db.update(c).set({ status: "expired", last_error: error }).where(eq(c.id, conn.id));
    return { ok: false, error };
  }

  const linked = await db
    .select()
    .from(s.bankAccounts)
    .where(and(eq(s.bankAccounts.connection_id, conn.id), eq(s.bankAccounts.user_id, userId), isNotNull(s.bankAccounts.account_id)))
    .orderBy(asc(s.bankAccounts.name));

  const [categories, memory] = await Promise.all([
    db.select().from(s.categories).where(eq(s.categories.user_id, userId)),
    db.select().from(s.placeMemory).where(eq(s.placeMemory.user_id, userId)).orderBy(desc(s.placeMemory.last_used)),
  ]);
  const categorizer = createCategorizer(categories.map(toCategory), memory.map(toPlaceMemory));

  let inserted = 0;
  try {
    for (const bank of linked) inserted += await syncAccount(userId, bank, categorizer);
  } catch (error) {
    const message = errorText(error);
    const expired = error instanceof BankApiError && (error.status === 401 || error.status === 403);
    await db.update(c).set({ last_error: message, ...(expired ? { status: "expired" as const } : {}) }).where(eq(c.id, conn.id));
    return { ok: false, error: message };
  }
  await db.update(c).set({ last_sync_at: new Date(), last_error: null, status: "active" }).where(eq(c.id, conn.id));
  await refreshInternalAccounts(userId);
  return { ok: true, summary: { inserted, accounts: linked.length } };
}

// ---------------------------------------------------------------------------
// Comptes internes (livrets…) suivis par les virements
// ---------------------------------------------------------------------------

/** Comptes internes : un identifiant renseigné, et pas alimentés eux-mêmes par la banque. */
async function internalAccounts(userId: string) {
  const [accounts, synced] = await Promise.all([
    db
      .select({ id: s.accounts.id, identifier: s.accounts.bank_identifier })
      .from(s.accounts)
      .where(and(eq(s.accounts.user_id, userId), isNotNull(s.accounts.bank_identifier))),
    db
      .select({ id: s.bankAccounts.account_id })
      .from(s.bankAccounts)
      .where(and(eq(s.bankAccounts.user_id, userId), isNotNull(s.bankAccounts.account_id))),
  ]);
  const syncedIds = new Set(synced.map((x) => x.id));
  return accounts.filter((a) => !syncedIds.has(a.id));
}

/**
 * Lignes bancaires dont le compte en face est un compte interne → virements entre les deux
 * comptes Pecunia : la ligne du compte synchronisé devient la moitié « transfer » et l'autre
 * moitié est créée sur le compte interne. Une ligne déjà convertie n'est jamais retouchée.
 */
async function applyInternalTransfers(userId: string): Promise<number> {
  const internal = await internalAccounts(userId);
  if (!internal.length) return 0;
  const t = s.transactions;
  const candidates = await db
    .select()
    .from(t)
    .where(and(eq(t.user_id, userId), isNotNull(t.bank_counterparty), isNull(t.transfer_id), inArray(t.type, ["in", "out"])));
  let converted = 0;
  for (const row of candidates) {
    const target = findInternalAccount(row.bank_counterparty, internal);
    if (!target || target.id === row.account_id) continue;
    const transferId = crypto.randomUUID();
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(t)
        .set({ type: "transfer", transfer_id: transferId, counterpart_account_id: target.id, category_id: null })
        .where(and(eq(t.id, row.id), eq(t.user_id, userId), isNull(t.transfer_id)))
        .returning({ id: t.id });
      if (!updated.length) return;
      await tx.insert(t).values({
        user_id: userId,
        account_id: target.id,
        type: "transfer",
        amount_cents: -Number(row.amount_cents),
        date: row.date,
        place: row.place,
        note: row.note,
        counterpart_account_id: row.account_id,
        transfer_id: transferId,
      });
      converted++;
    });
  }
  return converted;
}

/**
 * Solde initial des comptes à solde de référence (comptes internes) : le solde réel saisi à une
 * date, moins les lignes jusqu'à cette date. Les lignes ajoutées ensuite (historique complété,
 * virements reconnus) ne faussent donc jamais le solde.
 */
async function recomputeReferenceBalances(userId: string): Promise<void> {
  const t = s.transactions;
  const accounts = await db
    .select()
    .from(s.accounts)
    .where(and(eq(s.accounts.user_id, userId), isNotNull(s.accounts.reference_balance_cents), isNotNull(s.accounts.reference_balance_date)));
  for (const a of accounts) {
    const [sum] = await db
      .select({ total: sql<string>`coalesce(sum(${t.amount_cents}), 0)`, first: sql<string | null>`min(${t.date})` })
      .from(t)
      .where(and(eq(t.account_id, a.id), eq(t.user_id, userId), lte(t.date, a.reference_balance_date!)));
    const first = sum?.first ?? null;
    await db
      .update(s.accounts)
      .set({
        initial_balance_cents: initialBalanceFor(Number(a.reference_balance_cents), Number(sum?.total ?? 0)),
        initial_balance_date: first && first < a.reference_balance_date! ? first : a.reference_balance_date!,
      })
      .where(eq(s.accounts.id, a.id));
  }
}

/** Virements reconnus puis soldes de référence : après une synchronisation ou un réglage. */
export async function refreshInternalAccounts(userId: string): Promise<{ converted: number }> {
  const converted = await applyInternalTransfers(userId);
  await recomputeReferenceBalances(userId);
  return { converted };
}

/** Réglages d'un compte interne : identifiant reconnu dans les virements, solde réel connu. */
export async function saveInternalAccount(
  userId: string,
  input: { accountId: string; identifier: string | null; balanceCents: number | null; balanceDate: string | null },
): Promise<{ ok: true; converted: number } | { ok: false; error: string }> {
  const identifier = normalizeIdentifier(input.identifier);
  if (identifier && identifier.length < MIN_IDENTIFIER_LENGTH) return { ok: false, error: `L'identifiant doit faire au moins ${MIN_IDENTIFIER_LENGTH} caractères.` };
  const [account] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.id, input.accountId), eq(s.accounts.user_id, userId)));
  if (!account) return { ok: false, error: "Ce compte n'existe plus. Recharge la page." };
  const withBalance = input.balanceCents !== null && input.balanceDate !== null;
  await db
    .update(s.accounts)
    .set({
      bank_identifier: identifier,
      reference_balance_cents: withBalance ? input.balanceCents : null,
      reference_balance_date: withBalance ? input.balanceDate : null,
    })
    .where(eq(s.accounts.id, account.id));
  const { converted } = await refreshInternalAccounts(userId);
  return { ok: true, converted };
}

/** Ligne d'intérêts d'épargne (versés directement sur le compte, invisibles pour la synchronisation). */
export async function addInterest(userId: string, accountId: string, cents: number, date: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [account] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.id, accountId), eq(s.accounts.user_id, userId)));
  if (!account) return { ok: false, error: "Ce compte n'existe plus. Recharge la page." };
  await db.insert(s.transactions).values({ user_id: userId, account_id: account.id, type: "interest", amount_cents: cents, date, place: "Intérêts" });
  return { ok: true };
}

/** Synchronisation quotidienne : toutes les connexions actives, un utilisateur après l'autre. */
export async function syncAllConnections(): Promise<{ connections: number; inserted: number; failed: number }> {
  const c = s.bankConnections;
  const active = await db
    .select({ id: c.id, user_id: c.user_id })
    .from(c)
    .where(and(eq(c.status, "active"), isNotNull(c.session_id)));
  let inserted = 0;
  let failed = 0;
  for (const conn of active) {
    const result = await syncConnection(conn.user_id, conn.id);
    if (result.ok) inserted += result.summary.inserted;
    else failed++;
  }
  // les connexions dont le consentement a expiré sont marquées pour afficher « reconnecte-toi »
  await db.update(c).set({ status: "expired", last_error: "L'accès à ta banque a expiré : reconnecte-la." }).where(and(eq(c.status, "active"), lt(c.valid_until, new Date())));
  return { connections: active.length, inserted, failed };
}

// ---------------------------------------------------------------------------
// Lecture pour l'écran Paramètres
// ---------------------------------------------------------------------------

export interface BankOverview {
  configured: boolean;
  bankName: string;
  connection: {
    id: string;
    status: "active" | "expired" | "error";
    validUntil: string | null;
    lastSyncAt: string | null;
    lastError: string | null;
    accounts: { id: string; name: string | null; iban: string | null; accountId: string | null; bankBalanceCents: number | null }[];
  } | null;
  /** Comptes Pecunia (y compris archivés), avec leur solde et leurs réglages de compte interne */
  accounts: {
    id: string;
    name: string;
    type: "current" | "savings" | "cash";
    archived: boolean;
    balanceCents: number;
    identifier: string | null;
    referenceBalanceCents: number | null;
    referenceBalanceDate: string | null;
  }[];
  /** Comptes vus en face de lignes bancaires pas encore reconnues : aide à renseigner un identifiant */
  counterparties: { identifier: string; count: number; lastLabel: string | null; lastDate: string }[];
}

export async function getBankOverview(userId: string): Promise<BankOverview> {
  const c = s.bankConnections;
  const [conn] = await db
    .select()
    .from(c)
    .where(and(eq(c.user_id, userId), inArray(c.status, ["active", "expired", "error"])))
    .orderBy(desc(c.created_at))
    .limit(1);
  const t = s.transactions;
  const [accounts, bankAccounts, counterparties] = await Promise.all([
    db
      .select({
        id: s.accounts.id,
        name: s.accounts.name,
        type: s.accounts.type,
        archived_at: s.accounts.archived_at,
        bank_identifier: s.accounts.bank_identifier,
        reference_balance_cents: s.accounts.reference_balance_cents,
        reference_balance_date: s.accounts.reference_balance_date,
        balance: s.accountBalances.balance_cents,
      })
      .from(s.accounts)
      .leftJoin(s.accountBalances, eq(s.accountBalances.account_id, s.accounts.id))
      .where(eq(s.accounts.user_id, userId))
      .orderBy(asc(s.accounts.sort_order), asc(s.accounts.created_at)),
    conn ? db.select().from(s.bankAccounts).where(eq(s.bankAccounts.connection_id, conn.id)).orderBy(asc(s.bankAccounts.name)) : Promise.resolve([]),
    db
      .select({
        identifier: t.bank_counterparty,
        count: sql<number>`count(*)::int`,
        lastDate: sql<string>`max(${t.date})`,
        lastLabel: sql<string | null>`(array_agg(${t.place} order by ${t.date} desc))[1]`,
      })
      .from(t)
      .where(and(eq(t.user_id, userId), isNotNull(t.bank_counterparty), isNull(t.transfer_id)))
      .groupBy(t.bank_counterparty)
      .orderBy(desc(sql`count(*)`))
      .limit(12),
  ]);
  const ownIbans = new Set(bankAccounts.map((b) => normalizeIdentifier(b.iban)).filter(Boolean));
  return {
    configured: isBankConfigured(),
    bankName: bankName(),
    connection: conn
      ? {
          id: conn.id,
          status: conn.status as "active" | "expired" | "error",
          validUntil: conn.valid_until?.toISOString() ?? null,
          lastSyncAt: conn.last_sync_at?.toISOString() ?? null,
          lastError: conn.last_error,
          accounts: bankAccounts.map((b) => ({
            id: b.id,
            name: b.name,
            iban: b.iban,
            accountId: b.account_id,
            bankBalanceCents: b.bank_balance_cents === null ? null : Number(b.bank_balance_cents),
          })),
        }
      : null,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      archived: !!a.archived_at,
      balanceCents: Number(a.balance ?? 0),
      identifier: a.bank_identifier,
      referenceBalanceCents: a.reference_balance_cents === null ? null : Number(a.reference_balance_cents),
      referenceBalanceDate: a.reference_balance_date,
    })),
    counterparties: counterparties
      .filter((x): x is typeof x & { identifier: string } => !!x.identifier && !ownIbans.has(x.identifier))
      .map((x) => ({ identifier: x.identifier, count: Number(x.count), lastLabel: x.lastLabel, lastDate: x.lastDate })),
  };
}
