import { describe, expect, it } from "vitest";
import { account } from "./__fixtures__";
import type { ForecastDecision, ForecastItem, Wish } from "./types";
import { buildForecast, findForecastMatch, wishKey } from "./forecast";
import { wishMargin, wishStatuses } from "./wishes";
import { normalizeText } from "./csv-import";

const accounts = [
  account({ id: "courant", type: "current", inBudget: true }),
  account({ id: "livret", type: "savings", inBudget: false }),
];
const wish = (over: Partial<Wish> & Pick<Wish, "id">): Wish => ({
  source: "gkoi",
  externalId: `g-${over.id}`,
  title: over.id,
  amountCents: 12000,
  priority: null,
  dueDate: null,
  ...over,
});
const line = (over: Partial<ForecastItem> & Pick<ForecastItem, "id">): ForecastItem => ({
  accountId: "courant",
  label: over.id,
  amountCents: -12000,
  date: "2026-09-25",
  status: "planned",
  linkedTransactionId: null,
  seriesId: null,
  toAccountId: null,
  wishId: null,
  ...over,
});
const rejected = (sourceKey: string, month: string): ForecastDecision => ({
  id: sourceKey,
  sourceKey,
  month,
  status: "rejected",
  amountCents: null,
  accountId: null,
  date: null,
});

const forecast = (wishes: Wish[], forecastItems: ForecastItem[] = [], decisions: ForecastDecision[] = [], horizon = 3) =>
  buildForecast({
    accounts,
    balances: { courant: 100000, livret: 500000 },
    today: "2026-09-15",
    horizon,
    startDay: 1,
    occurrences: [],
    forecastItems,
    decisions,
    budgets: null,
    wishes,
  }).months;

describe("souhaits dans le prévisionnel", () => {
  it("sans échéance : proposé le mois en cours, à valider, sur le compte courant", () => {
    const [sept, oct] = forecast([wish({ id: "pneus", priority: "high" })]);
    expect(sept!.proposals).toMatchObject([
      { key: wishKey("pneus", "2026-09"), source: "wish", status: "pending", accountId: "courant", amountCents: 12000, priority: "high" },
    ]);
    expect(oct!.proposals).toEqual([]);
    // à valider : pas dans le solde projeté, seulement dans « si tout est accepté »
    expect(sept!.perAccount.courant).toMatchObject({ endBalanceCents: 100000, endIfAllCents: 88000 });
  });

  it("échéance future : proposé dans le mois de l'échéance ; échéance passée : le mois en cours", () => {
    const months = forecast([wish({ id: "futur", dueDate: "2026-11-05" }), wish({ id: "retard", dueDate: "2026-08-01" })]);
    expect(months.map((m) => m.proposals.map((p) => p.wishId))).toEqual([["retard"], [], ["futur"]]);
    expect(months[2]!.proposals[0]!.proposedDate).toBe("2026-11-05");
  });

  it("accepté (ligne prévue liée) : plus proposé, compté dans le solde", () => {
    const [sept] = forecast([wish({ id: "pneus" })], [line({ id: "l", wishId: "pneus" })]);
    expect(sept!.proposals).toEqual([]);
    expect(sept!.perAccount.courant!.endBalanceCents).toBe(88000);
  });

  it("refusé pour le mois : ni compté ni dans « si tout est accepté »", () => {
    const [sept] = forecast([wish({ id: "pneus" })], [], [rejected(wishKey("pneus", "2026-09"), "2026-09")]);
    expect(sept!.proposals[0]!.status).toBe("rejected");
    expect(sept!.perAccount.courant).toMatchObject({ endBalanceCents: 100000, endIfAllCents: 100000 });
  });
});

describe("marge pour G Koi À Faire", () => {
  it("solde de fin des comptes « dans le budget », souhaits réintégrés, moins le coussin", () => {
    const [sept] = forecast(
      [wish({ id: "propose", amountCents: 5000 }), wish({ id: "accepte" })],
      [line({ id: "l", wishId: "accepte" }), line({ id: "loyer", amountCents: -60000 })],
    );
    // 1 000 € − loyer 600 € − souhait accepté 120 € − souhait proposé 50 € = 230 € « si tout est accepté »
    const margin = wishMargin(sept!, accounts, 2000);
    expect(margin.endIfAllCents).toBe(23000);
    expect(margin.wishCents).toBe(17000);
    // les souhaits sont répartis par G Koi À Faire lui-même : 400 € − 20 € de coussin
    expect(margin.freeCents).toBe(38000);
  });

  it("le livret (hors budget) ne compte pas", () => {
    const [sept] = forecast([]);
    expect(wishMargin(sept!, accounts, 0).freeCents).toBe(100000);
  });
});

describe("état des souhaits renvoyé à G Koi À Faire", () => {
  it("proposé, refusé, prévu, réalisé avec le montant réellement payé", () => {
    const statuses = wishStatuses({
      wishes: [wish({ id: "a" }), wish({ id: "b" }), wish({ id: "c" }), wish({ id: "d" })],
      forecastItems: [
        line({ id: "lc", wishId: "c", amountCents: -11000, date: "2026-10-02" }),
        line({ id: "ld", wishId: "d", status: "linked", linkedTransactionId: "t1" }),
      ],
      decisions: [rejected(wishKey("b", "2026-09"), "2026-09"), rejected(wishKey("a", "2026-08"), "2026-08")],
      transactions: [{ id: "t1", amountCents: -13490, date: "2026-09-20" }],
      currentMonth: "2026-09",
    });
    expect(statuses).toEqual([
      { externalId: "g-a", state: "proposed", date: null, amountCents: 12000 },
      { externalId: "g-b", state: "rejected", date: null, amountCents: 12000 },
      { externalId: "g-c", state: "planned", date: "2026-10-02", amountCents: 11000 },
      { externalId: "g-d", state: "linked", date: "2026-09-20", amountCents: 13490 },
    ]);
  });
});

describe("rapprochement d'un souhait accepté", () => {
  const items = [line({ id: "pneus", label: "Changer les 2 pneus avant de la Clio", wishId: "w", amountCents: -12200, date: "2026-10-05" })];
  const entry = (place: string, signedCents: number) => findForecastMatch(items, { place, signedCents, date: "2026-10-03" }, normalizeText);

  it("reconnu au montant (±25 %) même si le lieu ne ressemble pas au libellé", () => {
    expect(entry("Norauto", -14500)?.id).toBe("pneus");
  });
  it("pas au-delà de la tolérance", () => {
    expect(entry("Norauto", -16000)).toBeNull();
  });
  it("une ligne prévue ordinaire exige toujours un libellé proche", () => {
    const plain = [{ ...items[0]!, wishId: null }];
    expect(findForecastMatch(plain, { place: "Norauto", signedCents: -12200, date: "2026-10-03" }, normalizeText)).toBeNull();
  });
});
