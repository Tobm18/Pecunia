import { describe, expect, it } from "vitest";
import { centsToInput, formatCents, formatCentsCompact, parseAmountToCents, sanitizeAmountInput } from "./money";
import { addMonths, dayLabel, isValidIsoDate, lastMonths, monthKeyOf, monthLabel, monthPeriod } from "./dates";

// Intl fr-FR utilise des espaces insécables : on les normalise pour comparer.
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("money", () => {
  it("formate en euros avec signe typographique", () => {
    expect(plain(formatCents(105000))).toBe("1 050,00 €");
    expect(plain(formatCents(-8430))).toBe("−84,30 €");
    expect(plain(formatCents(312, "always"))).toBe("+3,12 €");
    expect(plain(formatCents(-15000, "never"))).toBe("150,00 €");
    expect(plain(formatCentsCompact(325340))).toBe("3 253 €");
  });

  it("parse les saisies françaises sans flottants", () => {
    expect(parseAmountToCents("1 050,00")).toBe(105000);
    expect(parseAmountToCents("13,49")).toBe(1349);
    expect(parseAmountToCents("0.1")).toBe(10);
    expect(parseAmountToCents("12")).toBe(1200);
    expect(parseAmountToCents("-54,20")).toBe(-5420);
    expect(parseAmountToCents("12,345")).toBeNull();
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
  });

  it("filtre la frappe", () => {
    expect(sanitizeAmountInput("12a,5€")).toBe("12,5");
    expect(sanitizeAmountInput("-12")).toBe("12");
    expect(sanitizeAmountInput("1-2", true)).toBe("12");
    expect(sanitizeAmountInput("-12", true)).toBe("-12");
  });

  it("convertit en valeur éditable", () => {
    expect(centsToInput(105000)).toBe("1050,00");
    expect(centsToInput(-5)).toBe("-0,05");
  });
});

describe("dates", () => {
  it("navigue entre les mois", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(lastMonths("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("calcule la période du mois budgétaire", () => {
    expect(monthPeriod("2026-02", 1)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthPeriod("2026-10", 25)).toEqual({ start: "2026-09-25", end: "2026-10-24" });
    expect(monthKeyOf("2026-09-25", 25)).toBe("2026-10");
    expect(monthKeyOf("2026-09-24", 25)).toBe("2026-09");
    expect(monthKeyOf("2026-12-28", 25)).toBe("2027-01");
  });

  it("formate en français", () => {
    expect(monthLabel("2026-09")).toBe("Septembre 2026");
    expect(dayLabel("2026-09-28")).toBe("Lundi 28 septembre");
  });

  it("valide les dates", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-9-1")).toBe(false);
  });
});
