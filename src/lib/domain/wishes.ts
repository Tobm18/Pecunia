/**
 * Souhaits (achats en attente venant de G Koi À Faire) : marge du mois et état de chaque souhait,
 * renvoyés à l'app d'origine à chaque synchronisation.
 */
import type { Account, ForecastDecision, ForecastItem, Transaction, Wish } from "./types";
import type { ForecastMonth } from "./forecast";

export interface WishMargin {
  /** Ce que l'app des souhaits peut répartir ce mois-ci : voir wishMargin */
  freeCents: number;
  /** Solde de fin de mois des comptes « dans le budget », si toutes les propositions étaient acceptées */
  endIfAllCents: number;
  /** Part des souhaits dans ce solde (propositions et lignes prévues), réintégrée */
  wishCents: number;
  cushionCents: number;
}

/**
 * Marge du mois pour les souhaits = solde de fin de mois des comptes « dans le budget », en
 * comptant toutes les propositions comme acceptées (budgets compris : prudent), auquel on rajoute
 * ce qui vient des souhaits eux-mêmes (l'app d'origine les répartit elle-même dans cette marge),
 * moins le coussin de sécurité. Les dépenses déjà faites sont dans le solde : la marge est nette.
 */
export function wishMargin(month: ForecastMonth, accounts: Account[], cushionCents: number): WishMargin {
  const inBudget = new Set(accounts.filter((a) => !a.archivedAt && a.inBudget).map((a) => a.id));
  const endIfAllCents = [...inBudget].reduce((sum, id) => sum + (month.perAccount[id]?.endIfAllCents ?? 0), 0);
  const fromProposals = month.proposals
    .filter((p) => p.source === "wish" && p.status === "pending" && inBudget.has(p.accountId))
    .reduce((sum, p) => sum + p.amountCents, 0);
  const fromPlanned = month.planned
    .filter((f) => f.wishId && inBudget.has(f.accountId))
    .reduce((sum, f) => sum - f.amountCents, 0);
  const wishCents = fromProposals + fromPlanned;
  return { freeCents: endIfAllCents + wishCents - cushionCents, endIfAllCents, wishCents, cushionCents };
}

export type WishState = "proposed" | "rejected" | "planned" | "linked";

export interface WishStatus {
  externalId: string;
  state: WishState;
  /** Date prévue (ligne prévue) ou de la dépense réelle (réalisé) */
  date: string | null;
  /** Montant retenu (positif) : prévu, ou réellement payé une fois rapproché */
  amountCents: number;
}

/** État de chaque souhait, vu depuis le prévisionnel. */
export function wishStatuses(params: {
  wishes: Wish[];
  forecastItems: ForecastItem[];
  decisions: ForecastDecision[];
  transactions: Pick<Transaction, "id" | "amountCents" | "date">[];
  currentMonth: string;
}): WishStatus[] {
  const { wishes, forecastItems, decisions, transactions, currentMonth } = params;
  const lineByWish = new Map(forecastItems.filter((f) => f.wishId).map((f) => [f.wishId!, f]));
  const txById = new Map(transactions.map((t) => [t.id, t]));
  // refusé pour le mois où il est proposé (le mois en cours ou celui de son échéance)
  const rejected = new Set(
    decisions.filter((d) => d.status === "rejected" && d.month >= currentMonth && d.sourceKey.startsWith("wish:")).map((d) => d.sourceKey.split(":")[1]),
  );

  return wishes.map((w) => {
    const line = lineByWish.get(w.id);
    if (line?.status === "linked") {
      const tx = line.linkedTransactionId ? txById.get(line.linkedTransactionId) : undefined;
      return {
        externalId: w.externalId,
        state: "linked",
        date: tx?.date ?? line.date,
        amountCents: Math.abs(tx?.amountCents ?? line.amountCents),
      };
    }
    if (line) return { externalId: w.externalId, state: "planned", date: line.date, amountCents: -line.amountCents };
    return {
      externalId: w.externalId,
      state: rejected.has(w.id) ? "rejected" : "proposed",
      date: null,
      amountCents: w.amountCents,
    };
  });
}
