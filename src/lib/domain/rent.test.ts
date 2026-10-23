import { describe, expect, it } from "vitest";
import { allocateRent, periodAt, type RentPeriod } from "./rent";

describe("allocateRent", () => {
  const lines = [
    { id: "a", date: "2026-09-02", cents: 30000 },
    { id: "b", date: "2026-09-15", cents: 25000 },
    { id: "c", date: "2026-09-20", cents: 10000 },
    { id: "d", date: "2026-10-01", cents: 60000 },
  ];
  const since = (start: string, mode: RentPeriod["mode"], value: number): RentPeriod => ({ start, mode, value });

  it("montant mensuel : les virements du mois comptent dans l'ordre jusqu'au montant", () => {
    const parts = allocateRent(lines, [since("2000-01-01", "monthly", 45000)]);
    expect(Object.fromEntries(parts)).toEqual({ a: 30000, b: 15000, d: 45000 });
  });

  it("pourcentage de chaque virement", () => {
    const parts = allocateRent(lines, [since("2000-01-01", "percent", 50)]);
    expect(Object.fromEntries(parts)).toEqual({ a: 15000, b: 12500, c: 5000, d: 30000 });
  });

  it("chaque virement suit la période en vigueur à sa date (hausse de loyer)", () => {
    const parts = allocateRent(lines, [since("2026-01-01", "monthly", 40000), since("2026-10-01", "monthly", 50000)]);
    expect(Object.fromEntries(parts)).toEqual({ a: 30000, b: 10000, d: 50000 });
  });

  it("période à 0 : plus de loyer (déménagement) ; avant la première période : rien", () => {
    const parts = allocateRent(lines, [since("2026-09-10", "monthly", 45000), since("2026-10-01", "monthly", 0)]);
    expect(Object.fromEntries(parts)).toEqual({ b: 25000, c: 10000 });
  });

  it("changement de mode d'une période à l'autre", () => {
    const parts = allocateRent(lines, [since("2026-01-01", "percent", 100), since("2026-09-16", "monthly", 5000)]);
    expect(Object.fromEntries(parts)).toEqual({ a: 30000, b: 25000, c: 5000, d: 5000 });
  });

  it("période en vigueur", () => {
    const periods = [since("2026-01-01", "monthly", 1), since("2026-06-01", "monthly", 2)];
    expect(periodAt(periods, "2025-12-31")).toBeNull();
    expect(periodAt(periods, "2026-06-01")?.value).toBe(2);
  });
});
