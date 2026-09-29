import { describe, expect, it } from "vitest";
import { formatList } from "./text";

describe("formatList", () => {
  it("sépare par des virgules avec « et » avant le dernier élément", () => {
    expect(formatList(["Voitures", "Restaurants", "Autres", "Transport"])).toBe("Voitures, Restaurants, Autres et Transport");
    expect(formatList(["Santé à 92 %", "Courses à 80 %"])).toBe("Santé à 92 % et Courses à 80 %");
    expect(formatList(["Logement"])).toBe("Logement");
    expect(formatList([])).toBe("");
  });
});
