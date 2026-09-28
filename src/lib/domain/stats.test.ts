import { describe, expect, it } from "vitest";
import { demoAccounts, demoTransactions, account, tx } from "./__fixtures__";
import {
  accountBalance,
  balanceSeries,
  balanceSeriesFromCurrent,
  expensesByCategory,
  groupByDay,
  monthlyExpenses,
  signedTotal,
  summarize,
  topPlaces,
} from "./stats";

describe("summarize — règle des virements", () => {
  const s = summarize(demoTransactions, demoAccounts);

  it("compte les entrées y compris intérêts, sans régularisation ni virements", () => {
    expect(s.incomeCents).toBe(320000 + 4500 + 840);
    expect(s.interestCents).toBe(840);
  });

  it("exclut virements et régularisations des sorties", () => {
    expect(s.expenseCents).toBe(105000 + 8430 + 11260 + 1850 + 3250);
  });

  it("épargné = virements vers l'épargne + intérêts (retrait espèces exclu)", () => {
    expect(s.savingsTransfersCents).toBe(35000);
    expect(s.savedCents).toBe(35840);
  });

  it("taux d'épargne = solde / entrées", () => {
    expect(s.netCents).toBe(s.incomeCents - s.expenseCents);
    expect(s.savingsRate).toBeCloseTo(s.netCents / s.incomeCents);
  });

  it("filtre sur un compte", () => {
    const especes = summarize(demoTransactions, demoAccounts, "especes");
    expect(especes.expenseCents).toBe(1850);
    expect(especes.incomeCents).toBe(0);
    expect(especes.savingsRate).toBeNull();
    // le virement courant → livret est de l'épargne vu depuis le courant
    expect(summarize(demoTransactions, demoAccounts, "courant").savingsTransfersCents).toBe(35000);
    expect(summarize(demoTransactions, demoAccounts, "livret").savingsTransfersCents).toBe(20000);
  });

  it("épargne → épargne est neutre", () => {
    const accounts = [account({ id: "a", type: "savings" }), account({ id: "b", type: "savings" })];
    const txs = [
      tx({ accountId: "a", counterpartAccountId: "b", type: "transfer", amountCents: -1000, transferId: "x" }),
      tx({ accountId: "b", counterpartAccountId: "a", type: "transfer", amountCents: 1000, transferId: "x" }),
    ];
    expect(summarize(txs, accounts).savedCents).toBe(0);
  });
});

describe("signedTotal", () => {
  it("neutralise les virements en vue tous comptes mais garde la régularisation", () => {
    const s = summarize(demoTransactions, demoAccounts);
    expect(signedTotal(demoTransactions, null)).toBe(s.netCents + 312);
  });
  it("garde les virements vus depuis un compte", () => {
    expect(signedTotal(demoTransactions, "especes")).toBe(6000 - 1850);
  });
});

describe("expensesByCategory", () => {
  it("regroupe les sorties, trie et calcule les parts", () => {
    const rows = expensesByCategory(demoTransactions);
    expect(rows[0]).toMatchObject({ categoryId: "logement", cents: 105000 });
    expect(rows.find((r) => r.categoryId === "courses")?.cents).toBe(8430 + 11260 + 1850);
    expect(rows.reduce((s, r) => s + r.cents, 0)).toBe(summarize(demoTransactions, demoAccounts).expenseCents);
    expect(rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
  });
});

describe("topPlaces", () => {
  it("fusionne les lieux sans tenir compte de la casse", () => {
    const top = topPlaces(demoTransactions);
    expect(top[0]!.place).toBe("Loyer — SCI Belleville");
    expect(top[1]).toMatchObject({ place: "Carrefour", cents: 19690, count: 2 });
    expect(top.some((p) => p.place.startsWith("Virement"))).toBe(false);
  });
});

describe("monthlyExpenses", () => {
  it("répartit par mois budgétaire", () => {
    const txs = [
      tx({ accountId: "a", type: "out", amountCents: -1000, date: "2026-08-24" }),
      tx({ accountId: "a", type: "out", amountCents: -2000, date: "2026-08-25" }),
      tx({ accountId: "a", type: "transfer", amountCents: -5000, date: "2026-08-26", transferId: "x" }),
    ];
    expect(monthlyExpenses(txs, ["2026-08", "2026-09"], 1)).toEqual([
      { month: "2026-08", cents: 3000 },
      { month: "2026-09", cents: 0 },
    ]);
    expect(monthlyExpenses(txs, ["2026-08", "2026-09"], 25)).toEqual([
      { month: "2026-08", cents: 1000 },
      { month: "2026-09", cents: 2000 },
    ]);
  });
});

describe("soldes", () => {
  const a = account({ id: "a", initialBalanceCents: 10000 });
  const txs = [
    tx({ accountId: "a", type: "out", amountCents: -2500, date: "2026-07-10" }),
    tx({ accountId: "a", type: "adjust", amountCents: 12, date: "2026-08-02" }),
    tx({ accountId: "a", type: "transfer", amountCents: -1000, date: "2026-09-01", transferId: "x" }),
    tx({ accountId: "b", type: "in", amountCents: 99999, date: "2026-09-01" }),
  ];
  it("solde = initial + toutes les lignes du compte (virements et régularisations compris)", () => {
    expect(accountBalance(a, txs)).toBe(10000 - 2500 + 12 - 1000);
  });
  it("série de soldes en fin de période", () => {
    expect(balanceSeries(a, txs, ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"])).toEqual([
      10000, 7500, 7512, 6512,
    ]);
  });
  it("série reconstruite à rebours depuis le solde actuel", () => {
    const ends = ["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"];
    expect(balanceSeriesFromCurrent("a", accountBalance(a, txs), txs, ends)).toEqual(balanceSeries(a, txs, ends));
  });
});

describe("groupByDay", () => {
  it("groupe et trie les jours du plus récent au plus ancien", () => {
    const groups = groupByDay([{ date: "2026-09-01" }, { date: "2026-09-03" }, { date: "2026-09-01" }]);
    expect(groups.map((g) => [g.date, g.items.length])).toEqual([
      ["2026-09-03", 1],
      ["2026-09-01", 2],
    ]);
  });
});
