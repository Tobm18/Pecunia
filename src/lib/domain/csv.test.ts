import { describe, expect, it } from "vitest";
import { centsToCsv, csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("échappe les cellules", () => {
    expect(csvCell('Dîner "Léa"; 2')).toBe('"Dîner ""Léa""; 2"');
    expect(csvCell(null)).toBe("");
  });
  it("formate les montants à la française", () => {
    expect(centsToCsv(105000)).toBe("1050,00");
    expect(centsToCsv(-5)).toBe("-0,05");
  });
  it("assemble avec BOM et séparateur ;", () => {
    expect(toCsv(["a", "b"], [[1, "x"]])).toBe("﻿a;b\r\n1;x\r\n");
  });
});
