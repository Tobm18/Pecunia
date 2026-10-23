import { describe, expect, it } from "vitest";
import { allocateRent, isUnnamedTransfer, matchesRecipient, periodAt, type RentPeriod } from "./rent";

describe("allocateRent", () => {
  const lines = [
    { id: "a", date: "2026-09-02", cents: 30000 },
    { id: "b", date: "2026-09-15", cents: 25000 },
    { id: "c", date: "2026-09-20", cents: 10000 },
    { id: "d", date: "2026-10-01", cents: 60000 },
  ];
  const since = (start: string, mode: RentPeriod["mode"], value: number): RentPeriod => ({ start, mode, value });

  it("montant mensuel : les plus gros virements du mois comptent d'abord, jusqu'au montant", () => {
    const parts = allocateRent(lines, [since("2000-01-01", "monthly", 45000)]);
    // septembre : 300 + 150 ; le surplus de b (100) et c rattrapent rien (octobre payé par d)
    expect(Object.fromEntries(parts)).toEqual({ a: 30000, b: 15000, d: 45000 });
  });

  it("loyer payé d'avance : le surplus de mars couvre avril sans virement", () => {
    const spring = [
      { id: "mar-rent", date: "2025-03-05", cents: 20000 },
      { id: "mar-extra", date: "2025-03-30", cents: 30000 },
      { id: "may", date: "2025-05-27", cents: 20000 },
    ];
    expect(Object.fromEntries(allocateRent(spring, [since("2000-01-01", "monthly", 20000)]))).toEqual({
      "mar-rent": 20000,
      "mar-extra": 20000,
      may: 20000,
    });
  });

  it("rattrapage de plusieurs mois ; les petits virements ne comptent pas", () => {
    const luc = [
      { id: "mar", date: "2025-03-26", cents: 35000 },
      { id: "apr-small", date: "2025-04-01", cents: 364 },
      { id: "may", date: "2025-05-26", cents: 35000 },
      { id: "jun", date: "2025-06-26", cents: 35000 },
      { id: "jul-small", date: "2025-07-01", cents: 364 },
      { id: "jul", date: "2025-07-29", cents: 60000 },
    ];
    // juillet : 350 pour juillet, le reste (250) rattrape avril, impayé
    expect(Object.fromEntries(allocateRent(luc, [since("2024-12-01", "monthly", 35000)]))).toEqual({ mar: 35000, may: 35000, jun: 35000, jul: 60000 });
  });

  it("rattrapage : un gros virement complète le loyer incomplet du mois précédent", () => {
    const winter = [
      { id: "jan", date: "2026-01-27", cents: 17000 },
      { id: "feb", date: "2026-02-04", cents: 91300 },
      { id: "mar", date: "2026-03-27", cents: 40000 },
    ];
    const periods = [since("2024-12-01", "monthly", 20000), since("2026-02-01", "monthly", 40000)];
    expect(Object.fromEntries(allocateRent(winter, periods))).toEqual({ jan: 17000, feb: 43000, mar: 40000 });
  });

  it("le virement qui fait exactement le loyer passe avant les autres (octobre : 69 € puis 200 €)", () => {
    const october = [
      { id: "small", date: "2025-10-14", cents: 6900 },
      { id: "rent", date: "2025-10-28", cents: 20000 },
    ];
    expect(Object.fromEntries(allocateRent(october, [since("2000-01-01", "monthly", 20000)]))).toEqual({ rent: 20000 });
  });

  it("virement sans nom : compté seulement s'il fait exactement le loyer d'un mois non payé", () => {
    const periods = [since("2026-02-01", "monthly", 40000)];
    const months = [
      { id: "sept", date: "2026-09-25", cents: 40000, unnamed: true },
      { id: "other", date: "2026-09-06", cents: 1299, unnamed: true },
      { id: "aug-named", date: "2026-08-02", cents: 40000 },
      { id: "aug-unnamed", date: "2026-08-27", cents: 40000, unnamed: true },
    ];
    expect(Object.fromEntries(allocateRent(months, periods))).toEqual({ sept: 40000, "aug-named": 40000 });
  });

  it("le montant exact sans nom passe avant un petit virement nommé (juillet : 135 € puis 400 €)", () => {
    const july = [
      { id: "small", date: "2026-07-05", cents: 13500 },
      { id: "rent", date: "2026-07-28", cents: 40000, unnamed: true },
    ];
    expect(Object.fromEntries(allocateRent(july, [since("2026-02-01", "monthly", 40000)]))).toEqual({ rent: 40000 });
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
    // c (100 €) fait moins d'un quart de 450 € : un petit virement ne complète pas le mois
    expect(Object.fromEntries(parts)).toEqual({ b: 25000 });
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

describe("destinataire", () => {
  it("nom tronqué par la banque : reconnu", () => {
    expect(matchesRecipient("vir chouchounne", "vir chou")).toBe(true);
    expect(matchesRecipient("vir chouchounne", "vir chouc")).toBe(true);
    expect(matchesRecipient("vir chou", "vir chouchounne")).toBe(true);
    expect(matchesRecipient("vir chouchounne", "vir dalert manon")).toBe(false);
    expect(matchesRecipient("vir chouchounne", "vir")).toBe(false);
    expect(isUnnamedTransfer("vir")).toBe(true);
  });
});
