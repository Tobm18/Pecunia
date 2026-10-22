import { describe, expect, it } from "vitest";
import { account, category, budget, demoAccounts, transfer, tx } from "./__fixtures__";
import type { ForecastDecision, ForecastItem, Goal, Recurrence } from "./types";
import { buildOccurrences, monthlyEquivalentCents, occurrenceDates } from "./recurrences";
import { buildForecast, findForecastMatch, seriesDates } from "./forecast";
import { goalStatus, monthsUntil } from "./goals";
import { categorySeries, compareMonths, savingsByAccount } from "./analyses";
import { computeBudgets } from "./budgets";
import { normalizeText } from "./csv-import";

const rec = (over: Partial<Recurrence> & Pick<Recurrence, "id">): Recurrence => ({
  type: "out",
  label: over.id,
  amountCents: 10000,
  categoryId: null,
  accountId: "courant",
  toAccountId: null,
  frequency: "monthly",
  dueDay: 10,
  startDate: "2026-01-01",
  endDate: null,
  isSubscription: false,
  ...over,
});

describe("échéances", () => {
  it("mensuelle, jour ramené au dernier jour du mois", () => {
    expect(occurrenceDates(rec({ id: "r", dueDay: 31 }), "2026-01-15", "2026-04-30")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });
  it("trimestrielle et annuelle partent du mois de début", () => {
    expect(occurrenceDates(rec({ id: "q", frequency: "quarterly", startDate: "2026-02-01", dueDay: 5 }), "2026-01-01", "2026-12-31")).toEqual([
      "2026-02-05",
      "2026-05-05",
      "2026-08-05",
      "2026-11-05",
    ]);
    expect(occurrenceDates(rec({ id: "y", frequency: "yearly", startDate: "2025-03-01", dueDay: 15 }), "2026-01-01", "2027-12-31")).toEqual([
      "2026-03-15",
      "2027-03-15",
    ]);
  });
  it("hebdomadaire depuis la date de début, bornée par la date de fin", () => {
    expect(occurrenceDates(rec({ id: "w", frequency: "weekly", startDate: "2026-09-01", endDate: "2026-09-20" }), "2026-09-05", "2026-12-31")).toEqual([
      "2026-09-08",
      "2026-09-15",
    ]);
  });
  it("équivalent mensuel", () => {
    expect(monthlyEquivalentCents({ amountCents: 12000, frequency: "yearly" })).toBe(1000);
    expect(monthlyEquivalentCents({ amountCents: 1000, frequency: "weekly" })).toBe(4333);
  });
});

describe("statut des échéances", () => {
  const loyer = rec({ id: "loyer", label: "Loyer", amountCents: 44300, dueDay: 10 });
  const livret = rec({ id: "livret", type: "transfer", label: "Vers livret", amountCents: 20000, toAccountId: "livret", dueDay: 5 });

  it("lien explicite, puis reconnaissance d'une transaction importée proche", () => {
    const txs = [
      tx({ id: "t1", accountId: "courant", type: "out", amountCents: -44300, date: "2026-07-10", place: "Loyer", recurrenceId: "loyer" }),
      tx({ id: "t2", accountId: "courant", type: "out", amountCents: -44700, date: "2026-08-11", place: "loyer" }), // importé, montant proche
      tx({ id: "t3", accountId: "courant", type: "out", amountCents: -9000, date: "2026-09-10", place: "loyer" }), // montant trop différent
      ...transfer("courant", "livret", 20000, "2026-08-05"),
    ];
    const occ = buildOccurrences([loyer, livret], txs, "2026-07-01", "2026-09-30");
    const byKey = Object.fromEntries(occ.map((o) => [o.key, o]));
    expect(byKey["loyer|2026-07-10"]).toMatchObject({ status: "done", matched: false });
    expect(byKey["loyer|2026-08-10"]).toMatchObject({ status: "done", matched: true });
    expect(byKey["loyer|2026-09-10"]!.status).toBe("planned");
    expect(byKey["livret|2026-08-05"]).toMatchObject({ status: "done", matched: true });
    expect(byKey["livret|2026-09-05"]!.status).toBe("planned");
  });
});

describe("prévisionnel", () => {
  const accounts = [account({ id: "courant", type: "current", inBudget: true }), account({ id: "livret", type: "savings", inBudget: false })];
  const recurrences = [
    rec({ id: "salaire", type: "in", label: "Salaire", amountCents: 150000, dueDay: 1 }),
    rec({ id: "loyer", label: "Loyer", amountCents: 50000, dueDay: 10, categoryId: "logement" }),
    rec({ id: "epargne", type: "transfer", label: "Vers livret", amountCents: 30000, toAccountId: "livret", dueDay: 2 }),
  ];
  const txs = [tx({ accountId: "courant", type: "in", amountCents: 150000, date: "2026-09-01", place: "Salaire", recurrenceId: "salaire" })];
  const occurrences = buildOccurrences(recurrences, txs, "2026-09-01", "2026-11-30");
  const budgets = computeBudgets({
    budgets: [budget({ categoryId: "courses", amountCents: 40000 }), budget({ categoryId: "logement", amountCents: 50000 })],
    categories: [category({ id: "courses" }), category({ id: "logement" })],
    accounts,
    txs: [tx({ accountId: "courant", type: "out", amountCents: -10000, categoryId: "courses", date: "2026-09-05" })],
    referenceIncomeCents: 0,
  });
  const forecastItems: ForecastItem[] = [
    { id: "f1", accountId: "courant", label: "Assurance auto", amountCents: -120000, date: "2026-10-20", status: "planned", linkedTransactionId: null, seriesId: null, toAccountId: null, wishId: null },
  ];
  const decision = (sourceKey: string, status: ForecastDecision["status"], over: Partial<ForecastDecision> = {}): ForecastDecision => ({
    id: sourceKey,
    sourceKey,
    month: "2026-09",
    status,
    amountCents: null,
    accountId: null,
    date: null,
    ...over,
  });
  const run = (decisions: ForecastDecision[]) =>
    buildForecast({
      accounts,
      balances: { courant: 20000, livret: 100000 },
      today: "2026-09-15",
      horizon: 3,
      startDay: 1,
      occurrences,
      forecastItems,
      decisions,
      budgets,
    });

  it("échéances non réalisées acceptées d'office, reste des budgets à valider", () => {
    const { months, alerts } = run([]);
    const sept = months[0]!;
    expect(sept.proposals.map((p) => [p.key, p.amountCents, p.status])).toEqual([
      ["rec:epargne:2026-09-02", 30000, "accepted"],
      ["rec:loyer:2026-09-10", 50000, "accepted"],
      ["bud:courses:2026-09", 30000, "pending"], // 400 − 100 dépensés ; logement couvert par le loyer
    ]);
    expect(sept.realized.map((o) => o.recurrence.id)).toEqual(["salaire"]);
    expect(sept.pendingCount).toBe(1);
    expect(sept.perAccount.courant!.endBalanceCents).toBe(20000 - 30000 - 50000);
    expect(sept.perAccount.courant!.endIfAllCents).toBe(20000 - 30000 - 50000 - 30000);
    expect(sept.perAccount.livret!.endBalanceCents).toBe(130000);
    expect(alerts).toEqual([{ accountId: "courant", month: "2026-09", balanceCents: -60000 }]);
  });

  it("acceptée, modifiée ou refusée : seules les lignes retenues et les lignes prévues comptent", () => {
    const { months, alerts } = run([
      decision("rec:loyer:2026-09-10", "rejected"),
      decision("rec:epargne:2026-09-02", "accepted", { amountCents: 10000 }),
      decision("bud:courses:2026-09", "rejected"),
      decision("rec:salaire:2026-10-01", "accepted", { month: "2026-10", amountCents: 160000, date: "2026-10-03" }),
    ]);
    const sept = months[0]!;
    expect(sept.proposals.find((p) => p.key === "rec:epargne:2026-09-02")).toMatchObject({ status: "accepted", modified: true, amountCents: 10000 });
    expect(sept.perAccount.courant!.endBalanceCents).toBe(20000 - 10000);
    expect(sept.perAccount.livret!.endBalanceCents).toBe(110000);
    expect(alerts).toEqual([{ accountId: "courant", month: "2026-10", balanceCents: 10000 + 160000 - 50000 - 30000 - 120000 }]);

    const oct = months[1]!;
    expect(oct.proposals.find((p) => p.key === "rec:salaire:2026-10-01")).toMatchObject({ date: "2026-10-03", modified: true });
    // salaire modifié, loyer et virement d'office, assurance prévue ; les budgets sont à valider
    expect(oct.perAccount.courant!.netCents).toBe(160000 - 50000 - 30000 - 120000);
    expect(oct.perAccount.courant!).toMatchObject({ inCents: 160000, outCents: 200000 });
    expect(oct.pendingCount).toBe(1);
  });

  it("virement interne prévu : débite un compte, crédite l'autre", () => {
    const { months } = buildForecast({
      accounts,
      balances: { courant: 20000, livret: 100000 },
      today: "2026-09-15",
      horizon: 1,
      startDay: 1,
      occurrences: [],
      forecastItems: [
        { id: "v", accountId: "livret", toAccountId: "courant", label: "Renflouer", amountCents: -50000, date: "2026-09-25", status: "planned", linkedTransactionId: null, seriesId: null, wishId: null },
      ],
      decisions: [],
      budgets: null,
    });
    expect(months[0]!.perAccount.courant!.endBalanceCents).toBe(70000);
    expect(months[0]!.perAccount.livret!.endBalanceCents).toBe(50000);
  });

  it("répète une ligne prévue sur plusieurs mois", () => {
    expect(seriesDates("2026-11-30", 4)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28"]);
  });

  it("rapproche une saisie d'une dépense prévue", () => {
    const match = findForecastMatch(forecastItems, { place: "assurance AUTO", signedCents: -118000, date: "2026-10-18", accountId: "courant" }, normalizeText);
    expect(match?.id).toBe("f1");
    expect(findForecastMatch(forecastItems, { place: "assurance auto", signedCents: -50000, date: "2026-10-18" }, normalizeText)).toBeNull();
    expect(findForecastMatch(forecastItems, { place: "restaurant", signedCents: -120000, date: "2026-10-18" }, normalizeText)).toBeNull();
  });
});

describe("objectifs d'épargne", () => {
  const goal: Goal = { id: "g", accountId: "voyage", name: "Japon", targetCents: 340000, targetDate: "2026-11-01" };
  const recurrences = [rec({ id: "v", type: "transfer", accountId: "courant", toAccountId: "voyage", amountCents: 15000 })];

  it("compte les mois restants", () => {
    expect(monthsUntil("2026-09-28", "2026-11-01")).toBe(1);
    expect(monthsUntil("2026-09-01", "2027-06-30")).toBe(9);
  });

  it("en retard si les virements programmés ne suffisent pas", () => {
    const s = goalStatus(goal, 285000, recurrences, "2026-09-28");
    expect(s).toMatchObject({ remainingCents: 55000, monthsLeft: 1, neededPerMonthCents: 55000, plannedPerMonthCents: 15000, onTrack: false, shortfallCents: 40000 });
    expect(s.progress).toBeCloseTo(285000 / 340000);
  });

  it("en avance si atteint ou si le rythme suffit", () => {
    expect(goalStatus(goal, 340000, [], "2026-09-28").onTrack).toBe(true);
    expect(goalStatus({ ...goal, targetDate: "2027-12-01" }, 285000, recurrences, "2026-09-28").onTrack).toBe(true);
  });
});

describe("analyses", () => {
  it("compare au mois précédent, trié par amplitude, sans division par zéro", () => {
    const cur = [
      tx({ accountId: "a", type: "out", amountCents: -20000, categoryId: "resto" }),
      tx({ accountId: "a", type: "out", amountCents: -5000, categoryId: "sante" }),
      ...transfer("a", "b", 99999),
    ];
    const prev = [tx({ accountId: "a", type: "out", amountCents: -10000, categoryId: "resto" }), tx({ accountId: "a", type: "out", amountCents: -3000, categoryId: "loisirs" })];
    expect(compareMonths(cur, prev)).toEqual([
      { categoryId: "resto", currentCents: 20000, previousCents: 10000, change: 1 },
      { categoryId: "sante", currentCents: 5000, previousCents: 0, change: null },
      { categoryId: "loisirs", currentCents: 0, previousCents: 3000, change: -1 },
    ]);
  });

  it("épargne cumulée par compte : virements (hors épargne → épargne) et intérêts", () => {
    const txs = [
      ...transfer("courant", "livret", 20000),
      ...transfer("livret", "courant", 5000),
      ...transfer("livret", "voyage", 7000), // épargne → épargne : neutre
      tx({ accountId: "livret", type: "interest", amountCents: 1200 }),
    ];
    const rows = savingsByAccount(txs, demoAccounts);
    expect(rows.find((r) => r.account.id === "livret")).toMatchObject({ transfersCents: 15000, interestCents: 1200, totalCents: 16200 });
    expect(rows.find((r) => r.account.id === "voyage")).toMatchObject({ transfersCents: 0 });
  });

  it("série mensuelle d'une catégorie", () => {
    const txs = [
      tx({ accountId: "a", type: "out", amountCents: -1000, categoryId: "resto", date: "2026-08-03" }),
      tx({ accountId: "a", type: "out", amountCents: -2500, categoryId: "resto", date: "2026-09-03" }),
      tx({ accountId: "a", type: "out", amountCents: -999, categoryId: "autre", date: "2026-09-03" }),
    ];
    expect(categorySeries(txs, "resto", ["2026-08", "2026-09"])).toEqual([
      { month: "2026-08", cents: 1000 },
      { month: "2026-09", cents: 2500 },
    ]);
  });
});
