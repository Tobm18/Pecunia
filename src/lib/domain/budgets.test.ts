import { describe, expect, it } from "vitest";
import { budget, category, demoAccounts, demoTransactions, tx } from "./__fixtures__";
import { budgetStatus, carryOverFrom, computeBudgets, crossedThreshold, effectiveBudgetCents } from "./budgets";

const categories = [
  category({ id: "courses", sortOrder: 1 }),
  category({ id: "restaurants", sortOrder: 2 }),
  category({ id: "logement", sortOrder: 0 }),
  category({ id: "salaire", isIncome: true }),
];

describe("budgetStatus", () => {
  it("applique les seuils 80 % / 100 %", () => {
    expect(budgetStatus(0.79)).toBe("ok");
    expect(budgetStatus(0.8)).toBe("warn");
    expect(budgetStatus(0.999)).toBe("warn");
    expect(budgetStatus(1)).toBe("over");
  });
});

describe("effectiveBudgetCents", () => {
  it("fixe ou pourcentage du revenu de référence", () => {
    expect(effectiveBudgetCents(budget({ categoryId: "x", amountCents: 45000 }), 320000)).toBe(45000);
    expect(effectiveBudgetCents(budget({ categoryId: "x", mode: "percent", percent: 12.5 }), 320000)).toBe(40000);
  });
});

describe("computeBudgets", () => {
  const overview = computeBudgets({
    budgets: [
      budget({ categoryId: "courses", amountCents: 20000 }),
      budget({ categoryId: "restaurants", amountCents: 3000 }),
      budget({ categoryId: "logement", amountCents: 105000 }),
    ],
    categories,
    accounts: demoAccounts,
    txs: demoTransactions,
    referenceIncomeCents: 320000,
  });

  it("dépenses par catégorie sur les comptes dans le budget uniquement", () => {
    const courses = overview.lines.find((l) => l.category.id === "courses")!;
    // courant + espèces sont « dans le budget »
    expect(courses.spentCents).toBe(8430 + 11260 + 1850);
    expect(courses.status).toBe("over");
    expect(courses.remainingCents).toBe(20000 - 21540);
  });

  it("trie les lignes selon l'ordre des catégories et remonte les alertes", () => {
    expect(overview.lines.map((l) => l.category.id)).toEqual(["logement", "courses", "restaurants"]);
    expect(overview.alerts.map((l) => l.category.id)).toEqual(["restaurants", "courses", "logement"]);
  });

  it("budget global = toutes les dépenses des comptes dans le budget, virements exclus", () => {
    expect(overview.totalBudgetCents).toBe(128000);
    expect(overview.totalSpentCents).toBe(105000 + 8430 + 11260 + 1850 + 3250);
  });

  it("respecte les comptes restreints d'une catégorie", () => {
    const restricted = computeBudgets({
      budgets: [budget({ categoryId: "courses", amountCents: 20000 })],
      categories: [category({ id: "courses", restrictedAccountIds: ["especes"] })],
      accounts: demoAccounts,
      txs: demoTransactions,
      referenceIncomeCents: 0,
    });
    expect(restricted.lines[0]!.spentCents).toBe(1850);
  });

  it("ignore le budget d'une catégorie archivée", () => {
    const archived = computeBudgets({
      budgets: [budget({ categoryId: "courses", amountCents: 20000 })],
      categories: [category({ id: "courses", archivedAt: "2026-09-01" })],
      accounts: demoAccounts,
      txs: [],
      referenceIncomeCents: 0,
    });
    expect(archived.lines).toHaveLength(0);
    expect(archived.totalBudgetCents).toBe(0);
  });

  it("ajoute le report au budget global", () => {
    const withCarry = computeBudgets({
      budgets: [budget({ categoryId: "courses", amountCents: 20000 })],
      categories,
      accounts: demoAccounts,
      txs: [tx({ accountId: "courant", type: "out", amountCents: -5000, categoryId: "courses" })],
      referenceIncomeCents: 0,
      carryOverCents: 3000,
    });
    expect(withCarry.totalBudgetCents).toBe(23000);
    expect(withCarry.remainingCents).toBe(18000);
    expect(carryOverFrom(withCarry)).toBe(15000);
  });
});

describe("crossedThreshold", () => {
  it("détecte le passage de 80 % puis de 100 %", () => {
    expect(crossedThreshold(10000, 7000, 7500)).toBeNull();
    expect(crossedThreshold(10000, 7500, 8200)).toEqual({ ratio: 0.82, over: false });
    expect(crossedThreshold(10000, 8200, 8500)).toBeNull();
    expect(crossedThreshold(10000, 9000, 10100)).toEqual({ ratio: 1.01, over: true });
    expect(crossedThreshold(0, 0, 100)).toBeNull();
  });
});
