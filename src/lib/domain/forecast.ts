/**
 * Prévisionnel validé à la main.
 *
 * Pour chaque mois, l'application **propose** des lignes : les échéances des récurrences
 * pas encore réalisées et une ligne par budget de dépense (hors part déjà couverte par une
 * récurrence ; pour le mois en cours, seulement le reste à dépenser). Chaque proposition est
 * à valider : acceptée (éventuellement modifiée) ou refusée. S'y ajoutent les lignes prévues
 * saisies à la main (entrées / sorties, éventuellement sur plusieurs mois).
 *
 * Solde fin de mois = solde de début + propositions acceptées + lignes prévues.
 * Les propositions à valider ne comptent pas : elles donnent seulement le solde « si tout
 * est accepté ».
 */
import type { Account, ForecastDecision, ForecastItem } from "./types";
import type { BudgetOverview } from "./budgets";
import { addMonths, monthKeyOf, monthPeriod, type IsoDate, type MonthKey } from "./dates";
import type { Occurrence } from "./recurrences";

export type ProposalStatus = "pending" | "accepted" | "rejected";

export interface Proposal {
  /** Clé de décision (source_key) */
  key: string;
  source: "recurrence" | "budget";
  month: MonthKey;
  label: string;
  type: "out" | "in" | "transfer";
  categoryId: string | null;
  accountId: string;
  toAccountId: string | null;
  /** Montant proposé, positif */
  proposedCents: number;
  proposedDate: IsoDate | null;
  /** Montant et date retenus (modifiés ou proposés) */
  amountCents: number;
  date: IsoDate | null;
  status: ProposalStatus;
  modified: boolean;
}

export interface AccountMonth {
  /** Entrées / sorties retenues (acceptées + prévues), virements compris */
  inCents: number;
  outCents: number;
  netCents: number;
  endBalanceCents: number;
  /** Solde de fin de mois si toutes les propositions à valider étaient acceptées */
  endIfAllCents: number;
}

export interface ForecastMonth {
  month: MonthKey;
  proposals: Proposal[];
  planned: ForecastItem[];
  /** Échéances déjà réalisées ce mois-ci (pour information, déjà dans le solde) */
  realized: Occurrence[];
  perAccount: Record<string, AccountMonth>;
  pendingCount: number;
}

export interface NegativeAlert {
  accountId: string;
  month: MonthKey;
  balanceCents: number;
}

export const recurrenceKey = (recurrenceId: string, date: IsoDate) => `rec:${recurrenceId}:${date}`;
export const budgetKey = (categoryId: string, month: MonthKey) => `bud:${categoryId}:${month}`;

/** Mouvements d'une ligne sur les comptes : [compte, montant signé]. */
export function proposalEffects(p: Pick<Proposal, "type" | "accountId" | "toAccountId" | "amountCents">): [string, number][] {
  if (p.type === "transfer") {
    return p.toAccountId ? [[p.accountId, -p.amountCents], [p.toAccountId, p.amountCents]] : [[p.accountId, -p.amountCents]];
  }
  return [[p.accountId, p.type === "in" ? p.amountCents : -p.amountCents]];
}

export function buildForecast(params: {
  accounts: Account[];
  /** Solde actuel par compte */
  balances: Record<string, number>;
  today: IsoDate;
  horizon: number;
  startDay: number;
  /** Échéances couvrant l'horizon (réalisées ou non) */
  occurrences: Occurrence[];
  forecastItems: ForecastItem[];
  decisions: ForecastDecision[];
  /** Budgets du mois en cours (reste à dépenser, et montants des mois suivants) */
  budgets: BudgetOverview | null;
}): { months: ForecastMonth[]; alerts: NegativeAlert[] } {
  const { accounts, balances, today, horizon, startDay, occurrences, forecastItems, decisions, budgets } = params;
  const active = accounts.filter((a) => !a.archivedAt);
  const activeIds = new Set(active.map((a) => a.id));
  const currentMonth = monthKeyOf(today, startDay);
  const decisionByKey = new Map(decisions.map((d) => [d.sourceKey, d]));

  // Compte qui porte les budgets sans compte restreint : 1er compte courant « dans le budget »
  const mainAccount =
    active.find((a) => a.type === "current" && a.inBudget) ?? active.find((a) => a.inBudget) ?? active[0];

  const decide = (base: Omit<Proposal, "amountCents" | "date" | "status" | "modified">): Proposal => {
    const d = decisionByKey.get(base.key);
    const accountId = d?.accountId && activeIds.has(d.accountId) && base.type !== "transfer" ? d.accountId : base.accountId;
    const amountCents = d?.amountCents ?? base.proposedCents;
    const date = (base.source === "recurrence" && d?.date) || base.proposedDate;
    return {
      ...base,
      accountId,
      amountCents,
      date,
      status: d?.status ?? "pending",
      modified: !!d && (amountCents !== base.proposedCents || date !== base.proposedDate || accountId !== base.accountId),
    };
  };

  const running: Record<string, number> = Object.fromEntries(active.map((a) => [a.id, balances[a.id] ?? a.initialBalanceCents]));
  const runningIfAll = { ...running };
  const months: ForecastMonth[] = [];
  const alerts = new Map<string, NegativeAlert>();

  for (let i = 0; i < horizon; i++) {
    const month = addMonths(currentMonth, i);
    const period = monthPeriod(month, startDay);
    const inMonth = occurrences.filter((o) => o.date >= period.start && o.date <= period.end);
    const proposals: Proposal[] = [];

    // Échéances des récurrences
    const coveredByCategory = new Map<string, number>();
    for (const occ of inMonth) {
      const r = occ.recurrence;
      if (r.type === "out" && r.categoryId) coveredByCategory.set(r.categoryId, (coveredByCategory.get(r.categoryId) ?? 0) + r.amountCents);
      if (occ.status === "done" || !activeIds.has(r.accountId)) continue;
      proposals.push(
        decide({
          key: recurrenceKey(r.id, occ.date),
          source: "recurrence",
          month,
          label: r.label,
          type: r.type,
          categoryId: r.categoryId,
          accountId: r.accountId,
          toAccountId: r.type === "transfer" && r.toAccountId && activeIds.has(r.toAccountId) ? r.toAccountId : null,
          proposedCents: r.amountCents,
          proposedDate: occ.date,
        }),
      );
    }

    // Budgets de dépense (hors part couverte par une récurrence)
    for (const line of budgets?.lines ?? []) {
      const covered = coveredByCategory.get(line.category.id) ?? 0;
      const base = Math.max(0, line.budgetCents - covered);
      const spentOutsideRecurring = Math.max(0, line.spentCents - covered);
      const proposedCents = month === currentMonth ? Math.max(0, base - spentOutsideRecurring) : base;
      if (proposedCents <= 0) continue;
      const accountId = line.category.restrictedAccountIds.find((id) => activeIds.has(id)) ?? mainAccount?.id;
      if (!accountId) continue;
      proposals.push(
        decide({
          key: budgetKey(line.category.id, month),
          source: "budget",
          month,
          label: line.category.name,
          type: "out",
          categoryId: line.category.id,
          accountId,
          toAccountId: null,
          proposedCents,
          proposedDate: null,
        }),
      );
    }
    proposals.sort((a, b) => (a.date ?? "9999") < (b.date ?? "9999") ? -1 : (a.date ?? "9999") > (b.date ?? "9999") ? 1 : a.label.localeCompare(b.label));

    const planned = forecastItems
      .filter((f) => f.status === "planned" && f.date >= period.start && f.date <= period.end && activeIds.has(f.accountId))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const perAccount: Record<string, AccountMonth> = Object.fromEntries(
      active.map((a) => [a.id, { inCents: 0, outCents: 0, netCents: 0, endBalanceCents: 0, endIfAllCents: 0 }]),
    );
    const pendingNet: Record<string, number> = {};
    const count = (accountId: string, cents: number) => {
      const slot = perAccount[accountId];
      if (!slot) return;
      if (cents >= 0) slot.inCents += cents;
      else slot.outCents -= cents;
      slot.netCents += cents;
    };
    for (const p of proposals) {
      for (const [accountId, cents] of proposalEffects(p)) {
        if (p.status === "accepted") count(accountId, cents);
        else if (p.status === "pending") pendingNet[accountId] = (pendingNet[accountId] ?? 0) + cents;
      }
    }
    for (const f of planned) count(f.accountId, f.amountCents);

    for (const a of active) {
      const slot = perAccount[a.id]!;
      running[a.id] = running[a.id]! + slot.netCents;
      runningIfAll[a.id] = runningIfAll[a.id]! + slot.netCents + (pendingNet[a.id] ?? 0);
      slot.endBalanceCents = running[a.id]!;
      slot.endIfAllCents = runningIfAll[a.id]!;
      if (slot.endBalanceCents < 0 && !alerts.has(a.id)) alerts.set(a.id, { accountId: a.id, month, balanceCents: slot.endBalanceCents });
    }

    months.push({
      month,
      proposals,
      planned,
      realized: inMonth.filter((o) => o.status === "done"),
      perAccount,
      pendingCount: proposals.filter((p) => p.status === "pending").length,
    });
  }

  return { months, alerts: [...alerts.values()] };
}

/** Dates d'une ligne prévue répétée sur `count` mois, à partir de `first` (jour ramené à la fin du mois). */
export function seriesDates(first: IsoDate, count: number): IsoDate[] {
  const [y, m, d] = first.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const monthIndex = m - 1 + i;
    const year = y + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  });
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
