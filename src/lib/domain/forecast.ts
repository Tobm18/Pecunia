/**
 * Prévisionnel : solde projeté fin de mois, par compte.
 *
 * Solde fin de mois = solde de début
 *   + échéances de récurrences encore à venir (entrées, sorties, virements)
 *   + dépenses / revenus ponctuels prévus (non liés)
 *   − estimation des dépenses courantes (budgets de dépense, hors part déjà couverte par
 *     une récurrence ; pour le mois en cours, seulement le reste à dépenser).
 */
import type { Account, ForecastItem } from "./types";
import type { BudgetOverview } from "./budgets";
import { addMonths, monthKeyOf, monthPeriod, type IsoDate, type MonthKey } from "./dates";
import { signedRecurrenceCents, type Occurrence } from "./recurrences";

export type ForecastItemKind = "recurrence" | "transfer" | "planned" | "estimate";

export interface ProjectedItem {
  label: string;
  /** Signé, du point de vue du compte */
  amountCents: number;
  kind: ForecastItemKind;
  date: IsoDate | null;
}

export interface AccountMonth {
  items: ProjectedItem[];
  netCents: number;
  endBalanceCents: number;
}

export interface ProjectedMonth {
  month: MonthKey;
  perAccount: Record<string, AccountMonth>;
  totalEndCents: number;
}

export interface NegativeAlert {
  accountId: string;
  month: MonthKey;
  balanceCents: number;
}

export function projectBalances(params: {
  accounts: Account[];
  /** Solde actuel par compte */
  balances: Record<string, number>;
  today: IsoDate;
  horizon: number;
  startDay: number;
  /** Échéances couvrant l'horizon (réalisées ou non) */
  occurrences: Occurrence[];
  forecastItems: ForecastItem[];
  /** Budgets du mois en cours (pour le reste à dépenser et l'estimation des mois suivants) */
  budgets: BudgetOverview | null;
}): { months: ProjectedMonth[]; alerts: NegativeAlert[] } {
  const { accounts, balances, today, horizon, startDay, occurrences, forecastItems, budgets } = params;
  const active = accounts.filter((a) => !a.archivedAt);
  const activeIds = new Set(active.map((a) => a.id));
  const currentMonth = monthKeyOf(today, startDay);
  const months = Array.from({ length: horizon }, (_, i) => addMonths(currentMonth, i));

  // Compte qui porte l'estimation des dépenses courantes : 1er compte courant « dans le budget »
  const mainAccount =
    active.find((a) => a.type === "current" && a.inBudget) ?? active.find((a) => a.inBudget) ?? active[0];

  // Part des budgets déjà couverte par des sorties récurrentes (évite le double comptage)
  const recurringByCategory = new Map<string, number>();

  const running: Record<string, number> = Object.fromEntries(active.map((a) => [a.id, balances[a.id] ?? a.initialBalanceCents]));
  const result: ProjectedMonth[] = [];
  const alerts = new Map<string, NegativeAlert>();

  for (const month of months) {
    const period = monthPeriod(month, startDay);
    const perAccount: Record<string, AccountMonth> = Object.fromEntries(
      active.map((a) => [a.id, { items: [], netCents: 0, endBalanceCents: 0 } as AccountMonth]),
    );
    const add = (accountId: string, item: ProjectedItem) => {
      const slot = perAccount[accountId];
      if (!slot) return;
      slot.items.push(item);
      slot.netCents += item.amountCents;
    };

    recurringByCategory.clear();
    for (const occ of occurrences) {
      if (occ.date < period.start || occ.date > period.end) continue;
      const r = occ.recurrence;
      if (r.type === "out" && r.categoryId) {
        recurringByCategory.set(r.categoryId, (recurringByCategory.get(r.categoryId) ?? 0) + r.amountCents);
      }
      if (occ.status === "done") continue; // déjà dans le solde actuel
      if (r.type === "transfer") {
        add(r.accountId, { label: r.label, amountCents: -r.amountCents, kind: "transfer", date: occ.date });
        if (r.toAccountId && activeIds.has(r.toAccountId)) {
          add(r.toAccountId, { label: r.label, amountCents: r.amountCents, kind: "transfer", date: occ.date });
        }
      } else {
        add(r.accountId, { label: r.label, amountCents: signedRecurrenceCents(r), kind: "recurrence", date: occ.date });
      }
    }

    for (const f of forecastItems) {
      if (f.status !== "planned" || f.date < period.start || f.date > period.end) continue;
      if (month === currentMonth && f.date < today) continue; // échue : à saisir, plus prévue
      add(f.accountId, { label: f.label, amountCents: f.amountCents, kind: "planned", date: f.date });
    }

    // Estimation des dépenses courantes par ligne de budget de dépense
    if (budgets) {
      for (const line of budgets.lines) {
        const covered = recurringByCategory.get(line.category.id) ?? 0;
        const base = Math.max(0, line.budgetCents - covered);
        const spentOutsideRecurring = Math.max(0, line.spentCents - covered);
        const estimate = month === currentMonth ? Math.max(0, base - spentOutsideRecurring) : base;
        if (estimate <= 0) continue;
        const target = line.category.restrictedAccountIds.find((id) => activeIds.has(id)) ?? mainAccount?.id;
        if (target) add(target, { label: `Dépenses courantes · ${line.category.name}`, amountCents: -estimate, kind: "estimate", date: null });
      }
    }

    let total = 0;
    for (const a of active) {
      const slot = perAccount[a.id]!;
      running[a.id] = running[a.id]! + slot.netCents;
      slot.endBalanceCents = running[a.id]!;
      slot.items.sort((x, y) => (x.date ?? "9999") < (y.date ?? "9999") ? -1 : 1);
      total += slot.endBalanceCents;
      if (slot.endBalanceCents < 0 && !alerts.has(a.id)) {
        alerts.set(a.id, { accountId: a.id, month, balanceCents: slot.endBalanceCents });
      }
    }
    result.push({ month, perAccount, totalEndCents: total });
  }

  return { months: result, alerts: [...alerts.values()] };
}

/**
 * Dépense prévue correspondant à une saisie (rapprochement) : même compte si fourni,
 * libellé proche, montant à ±10 % (au moins 1 €), date dans les 45 jours.
 */
export function findForecastMatch(
  items: ForecastItem[],
  entry: { place: string; signedCents: number; date: IsoDate; accountId?: string | null },
  normalize: (s: string) => string,
): ForecastItem | null {
  const place = normalize(entry.place).replace(/[^a-z0-9]+/g, " ").trim();
  if (!place || entry.signedCents === 0) return null;
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  return (
    items.find((f) => {
      if (f.status !== "planned") return false;
      if (entry.accountId && f.accountId !== entry.accountId) return false;
      const label = normalize(f.label).replace(/[^a-z0-9]+/g, " ").trim();
      if (!label || !(label === place || label.includes(place) || place.includes(label))) return false;
      if (Math.sign(f.amountCents) !== Math.sign(entry.signedCents)) return false;
      const tolerance = Math.max(100, Math.round(Math.abs(f.amountCents) * 0.1));
      if (Math.abs(f.amountCents - entry.signedCents) > tolerance) return false;
      return Math.abs(day(f.date) - day(entry.date)) <= 45;
    }) ?? null
  );
}
