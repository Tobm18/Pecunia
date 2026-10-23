import { describe, expect, it } from "vitest";
import { allocateRent } from "./rent";

describe("allocateRent", () => {
  const lines = [
    { id: "a", date: "2026-09-02", cents: 30000 },
    { id: "b", date: "2026-09-15", cents: 25000 },
    { id: "c", date: "2026-09-20", cents: 10000 },
    { id: "d", date: "2026-10-01", cents: 60000 },
  ];

  it("montant mensuel : les virements du mois comptent dans l'ordre jusqu'au montant", () => {
    const parts = allocateRent(lines, { mode: "monthly", value: 45000 });
    expect(Object.fromEntries(parts)).toEqual({ a: 30000, b: 15000, d: 45000 });
  });

  it("pourcentage de chaque virement", () => {
    const parts = allocateRent(lines, { mode: "percent", value: 50 });
    expect(Object.fromEntries(parts)).toEqual({ a: 15000, b: 12500, c: 5000, d: 30000 });
  });

  it("100 % : tout le virement est du loyer ; règle vide : rien", () => {
    expect(allocateRent([lines[0]!], { mode: "percent", value: 100 }).get("a")).toBe(30000);
    expect(allocateRent(lines, { mode: "monthly", value: 0 }).size).toBe(0);
  });
});
