/**
 * Schéma Drizzle, miroir de db/migrations/*.sql (la source de vérité reste le SQL).
 * Tables métier : clés en snake_case, identiques aux colonnes, pour que les lignes lues
 * passent telles quelles dans data/mappers.ts. Tables d'authentification : clés en
 * camelCase, attendues par l'adaptateur Better Auth.
 */
import { bigint, boolean, date, integer, numeric, pgEnum, pgTable, pgView, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const cents = (name: string) => bigint(name, { mode: "number" });
const day = (name: string) => date(name, { mode: "string" });

// ---------------------------------------------------------------------------
// Authentification (Better Auth)
// ---------------------------------------------------------------------------
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Clés d'API (module @better-auth/api-key) : accès d'une autre application, par permissions. */
export const apikey = pgTable("apikey", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: text("config_id").notNull().default("default"),
  name: text("name"),
  start: text("start"),
  referenceId: uuid("reference_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  prefix: text("prefix"),
  key: text("key").notNull(),
  refillInterval: bigint("refill_interval", { mode: "number" }),
  refillAmount: integer("refill_amount"),
  lastRefillAt: ts("last_refill_at"),
  enabled: boolean("enabled").default(true),
  rateLimitEnabled: boolean("rate_limit_enabled").default(true),
  rateLimitTimeWindow: bigint("rate_limit_time_window", { mode: "number" }),
  rateLimitMax: integer("rate_limit_max"),
  requestCount: integer("request_count").default(0),
  remaining: integer("remaining"),
  lastRequest: ts("last_request"),
  expiresAt: ts("expires_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  permissions: text("permissions"),
  metadata: text("metadata"),
});

export const passkey = pgTable("passkey", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: uuid("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull().default(0),
  deviceType: text("device_type").notNull(),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  createdAt: ts("created_at").defaultNow(),
  aaguid: text("aaguid"),
});

// ---------------------------------------------------------------------------
// Données métier
// ---------------------------------------------------------------------------
export const accountType = pgEnum("account_type", ["current", "savings", "cash"]);
export const budgetMode = pgEnum("budget_mode", ["fixed", "percent"]);
export const transactionType = pgEnum("transaction_type", ["out", "in", "transfer", "interest", "adjust"]);
export const recurrenceFrequency = pgEnum("recurrence_frequency", ["weekly", "monthly", "quarterly", "yearly"]);
export const forecastStatus = pgEnum("forecast_status", ["planned", "linked"]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  display_name: text("display_name"),
  currency: text("currency").notNull().default("EUR"),
  date_format: text("date_format").notNull().default("dd/MM/yyyy"),
  month_start_day: smallint("month_start_day").notNull().default(1),
  theme: text("theme").notNull().default("light"),
  reference_income_cents: cents("reference_income_cents").notNull().default(0),
  budget_carry_over: boolean("budget_carry_over").notNull().default(false),
  wish_cushion_cents: cents("wish_cushion_cents").notNull().default(0),
  last_backup_at: ts("last_backup_at"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  type: accountType("type").notNull().default("current"),
  initial_balance_cents: cents("initial_balance_cents").notNull().default(0),
  initial_balance_date: day("initial_balance_date").notNull(),
  color: text("color").notNull().default("#334155"),
  icon: text("icon").notNull().default("card"),
  in_budget: boolean("in_budget").notNull().default(true),
  sort_order: integer("sort_order").notNull().default(0),
  archived_at: ts("archived_at"),
  /** Compte interne : IBAN ou numéro reconnu dans les virements du compte synchronisé */
  bank_identifier: text("bank_identifier"),
  /** Solde réel connu à une date ; le solde initial en est déduit */
  reference_balance_cents: cents("reference_balance_cents"),
  reference_balance_date: day("reference_balance_date"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#94a3b8"),
  icon: text("icon").notNull().default("circle"),
  is_income: boolean("is_income").notNull().default(false),
  restricted_account_ids: uuid("restricted_account_ids").array().notNull().default([]),
  sort_order: integer("sort_order").notNull().default(0),
  archived_at: ts("archived_at"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  category_id: uuid("category_id").notNull().unique(),
  mode: budgetMode("mode").notNull().default("fixed"),
  amount_cents: cents("amount_cents").notNull().default(0),
  percent: numeric("percent", { precision: 5, scale: 2, mode: "number" }),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  account_id: uuid("account_id").notNull(),
  type: transactionType("type").notNull(),
  amount_cents: cents("amount_cents").notNull(),
  date: day("date").notNull(),
  place: text("place"),
  category_id: uuid("category_id"),
  note: text("note"),
  counterpart_account_id: uuid("counterpart_account_id"),
  transfer_id: uuid("transfer_id"),
  recurrence_id: uuid("recurrence_id"),
  /** Référence de la ligne chez la banque (connexion bancaire) : évite les doublons à la resynchronisation */
  bank_ref: text("bank_ref"),
  /** Compte en face (IBAN ou numéro) : compte créditeur d'un débit, donneur d'ordre d'un crédit */
  bank_counterparty: text("bank_counterparty"),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const recurrences = pgTable("recurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  type: transactionType("type").notNull(),
  label: text("label").notNull(),
  amount_cents: cents("amount_cents").notNull(),
  category_id: uuid("category_id"),
  account_id: uuid("account_id").notNull(),
  to_account_id: uuid("to_account_id"),
  frequency: recurrenceFrequency("frequency").notNull().default("monthly"),
  due_day: smallint("due_day").notNull().default(1),
  start_date: day("start_date").notNull(),
  end_date: day("end_date"),
  is_subscription: boolean("is_subscription").notNull().default(false),
  created_at: ts("created_at").notNull().defaultNow(),
});

export const forecastItems = pgTable("forecast_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  account_id: uuid("account_id").notNull(),
  label: text("label").notNull(),
  amount_cents: cents("amount_cents").notNull(),
  date: day("date").notNull(),
  status: forecastStatus("status").notNull().default("planned"),
  linked_transaction_id: uuid("linked_transaction_id"),
  series_id: uuid("series_id"),
  to_account_id: uuid("to_account_id"),
  /** Ligne issue d'un souhait accepté */
  wish_id: uuid("wish_id"),
  created_at: ts("created_at").notNull().defaultNow(),
});

/** Souhaits : achats en attente tenus à jour par une autre app (ex. G Koi À Faire). */
export const wishes = pgTable("wishes", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  source: text("source").notNull().default("gkoi"),
  external_id: text("external_id").notNull(),
  title: text("title").notNull(),
  amount_cents: cents("amount_cents").notNull(),
  priority: text("priority", { enum: ["high", "medium", "low"] }),
  due_date: day("due_date"),
  created_at: ts("created_at").notNull().defaultNow(),
  updated_at: ts("updated_at").notNull().defaultNow(),
});

/** Consentement donné à une banque (Enable Banking, lecture seule). */
export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  aspsp_name: text("aspsp_name").notNull(),
  state: text("state"),
  session_id: text("session_id"),
  status: text("status", { enum: ["pending", "active", "expired", "error"] })
    .notNull()
    .default("pending"),
  valid_until: ts("valid_until"),
  last_sync_at: ts("last_sync_at"),
  last_error: text("last_error"),
  created_at: ts("created_at").notNull().defaultNow(),
});

/** Compte distant d'une connexion, éventuellement relié à un compte Pecunia. */
export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  connection_id: uuid("connection_id").notNull(),
  uid: text("uid").notNull(),
  iban: text("iban"),
  name: text("name"),
  currency: text("currency"),
  account_id: uuid("account_id"),
  synced_until: day("synced_until"),
  bank_balance_cents: cents("bank_balance_cents"),
});

export const forecastDecisions = pgTable("forecast_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  source_key: text("source_key").notNull(),
  month: text("month").notNull(),
  status: text("status", { enum: ["accepted", "rejected"] }).notNull(),
  amount_cents: cents("amount_cents"),
  account_id: uuid("account_id"),
  date: day("date"),
  created_at: ts("created_at").notNull().defaultNow(),
  updated_at: ts("updated_at").notNull().defaultNow(),
});

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  account_id: uuid("account_id").notNull(),
  name: text("name").notNull(),
  target_cents: cents("target_cents").notNull(),
  target_date: day("target_date").notNull(),
  created_at: ts("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Vues
// ---------------------------------------------------------------------------
export const accountBalances = pgView("account_balances", {
  account_id: uuid("account_id").notNull(),
  user_id: uuid("user_id").notNull(),
  balance_cents: cents("balance_cents").notNull(),
  transaction_count: cents("transaction_count").notNull(),
}).existing();

export const placeMemory = pgView("place_memory", {
  user_id: uuid("user_id").notNull(),
  place: text("place").notNull(),
  category_id: uuid("category_id"),
  account_id: uuid("account_id").notNull(),
  last_used: day("last_used").notNull(),
}).existing();
