/** Conversion lignes SQL (snake_case) ↔ objets métier (camelCase). */
import type { Account, Budget, Category, ForecastItem, Goal, PlaceMemoryEntry, Profile, Recurrence, Transaction } from "@/lib/domain/types";

// bigint Postgres → number JS : sûr jusqu'à 2^53 centimes (~90 000 milliards d'euros)
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

export const toAccount = (r: Row): Account => ({
  id: r.id,
  name: r.name,
  type: r.type,
  initialBalanceCents: num(r.initial_balance_cents),
  initialBalanceDate: r.initial_balance_date,
  color: r.color,
  icon: r.icon,
  inBudget: r.in_budget,
  sortOrder: r.sort_order,
  archivedAt: r.archived_at,
});

export const toCategory = (r: Row): Category => ({
  id: r.id,
  name: r.name,
  color: r.color,
  icon: r.icon,
  isIncome: r.is_income,
  restrictedAccountIds: r.restricted_account_ids ?? [],
  sortOrder: r.sort_order,
  archivedAt: r.archived_at,
});

export const toBudget = (r: Row): Budget => ({
  id: r.id,
  categoryId: r.category_id,
  mode: r.mode,
  amountCents: num(r.amount_cents),
  percent: r.percent === null ? null : Number(r.percent),
});

export const toTransaction = (r: Row): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  type: r.type,
  amountCents: num(r.amount_cents),
  date: r.date,
  place: r.place,
  categoryId: r.category_id,
  note: r.note,
  counterpartAccountId: r.counterpart_account_id,
  transferId: r.transfer_id,
  recurrenceId: r.recurrence_id,
  createdAt: r.created_at,
});

export const toProfile = (r: Row): Profile => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  currency: r.currency,
  monthStartDay: r.month_start_day,
  theme: r.theme,
  referenceIncomeCents: num(r.reference_income_cents),
  budgetCarryOver: r.budget_carry_over,
  lastBackupAt: r.last_backup_at,
});

export const toPlaceMemory = (r: Row): PlaceMemoryEntry => ({
  place: r.place,
  categoryId: r.category_id,
  accountId: r.account_id,
  lastUsed: r.last_used,
});

export const transactionToRow = (t: Omit<Transaction, "id" | "createdAt" | "recurrenceId">, userId: string) => ({
  user_id: userId,
  account_id: t.accountId,
  type: t.type,
  amount_cents: t.amountCents,
  date: t.date,
  place: t.place,
  category_id: t.categoryId,
  note: t.note,
  counterpart_account_id: t.counterpartAccountId,
  transfer_id: t.transferId,
});

export const toRecurrence = (r: Row): Recurrence => ({
  id: r.id,
  type: r.type,
  label: r.label,
  amountCents: num(r.amount_cents),
  categoryId: r.category_id,
  accountId: r.account_id,
  toAccountId: r.to_account_id,
  frequency: r.frequency,
  dueDay: r.due_day,
  startDate: r.start_date,
  endDate: r.end_date,
  isSubscription: r.is_subscription,
});

export const toForecastItem = (r: Row): ForecastItem => ({
  id: r.id,
  accountId: r.account_id,
  label: r.label,
  amountCents: num(r.amount_cents),
  date: r.date,
  status: r.status,
  linkedTransactionId: r.linked_transaction_id,
});

export const toGoal = (r: Row): Goal => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  targetCents: num(r.target_cents),
  targetDate: r.target_date,
});
