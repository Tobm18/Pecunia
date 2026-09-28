import { describe, expect, it } from "vitest";
import { demoAccounts } from "./__fixtures__";
import { adjustmentCents, buildEntry, ENTRY_ERRORS, type EntryInput } from "./entries";
import { findPlace, suggestPlaces } from "./places";

const base: EntryInput = {
  kind: "out",
  amount: "84,30",
  place: " Carrefour ",
  categoryId: "courses",
  accountId: "courant",
  toAccountId: null,
  nature: "income",
  date: "2026-09-28",
  note: "",
};
const newId = () => "id-1";

describe("buildEntry", () => {
  it("crée une sortie négative", () => {
    const r = buildEntry(base, demoAccounts, newId);
    expect(r).toEqual({
      ok: true,
      rows: [expect.objectContaining({ type: "out", amountCents: -8430, place: "Carrefour", note: null })],
    });
  });

  it("refuse montant nul ou lieu vide", () => {
    expect(buildEntry({ ...base, amount: "0" }, demoAccounts, newId)).toEqual({ ok: false, error: ENTRY_ERRORS.amountAndPlace });
    expect(buildEntry({ ...base, place: "  " }, demoAccounts, newId)).toEqual({ ok: false, error: ENTRY_ERRORS.amountAndPlace });
    expect(buildEntry({ ...base, categoryId: null }, demoAccounts, newId)).toEqual({ ok: false, error: ENTRY_ERRORS.category });
  });

  it("entrée sur un compte d'épargne : intérêts sans catégorie", () => {
    const r = buildEntry(
      { ...base, kind: "in", accountId: "voyage", nature: "interest", categoryId: null, amount: "8,40" },
      demoAccounts,
      newId,
    );
    expect(r.ok && r.rows[0]).toMatchObject({ type: "interest", amountCents: 840 });
  });

  it("la nature est ignorée hors compte d'épargne", () => {
    const r = buildEntry({ ...base, kind: "in", nature: "interest", categoryId: "salaire" }, demoAccounts, newId);
    expect(r.ok && r.rows[0]).toMatchObject({ type: "in", amountCents: 8430 });
  });

  it("virement : deux lignes liées, libellé par défaut, sans catégorie", () => {
    const r = buildEntry(
      { ...base, kind: "transfer", place: "", categoryId: "courses", toAccountId: "livret", amount: "200" },
      demoAccounts,
      newId,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ accountId: "courant", counterpartAccountId: "livret", amountCents: -20000, categoryId: null, place: "Virement livret", transferId: "id-1" });
    expect(r.rows[1]).toMatchObject({ accountId: "livret", counterpartAccountId: "courant", amountCents: 20000, transferId: "id-1" });
  });

  it("virement vers le même compte refusé", () => {
    expect(buildEntry({ ...base, kind: "transfer", toAccountId: "courant" }, demoAccounts, newId)).toEqual({
      ok: false,
      error: ENTRY_ERRORS.sameAccounts,
    });
  });
});

describe("adjustmentCents", () => {
  it("ne crée une régularisation qu'à partir d'un centime d'écart", () => {
    expect(adjustmentCents(864012, 864012)).toBeNull();
    expect(adjustmentCents(218125, 218437)).toBe(312);
    expect(adjustmentCents(100, 50)).toBe(-50);
  });
});

describe("mémoire des lieux", () => {
  const memory = [
    { place: "Carrefour", categoryId: "courses", accountId: "courant", lastUsed: "2026-09-28" },
    { place: "Carrefour City", categoryId: "courses", accountId: "especes", lastUsed: "2026-09-01" },
    { place: "Le Petit Bouillon", categoryId: "restaurants", accountId: "courant", lastUsed: "2026-09-12" },
  ];
  it("correspondance exacte insensible à la casse", () => {
    expect(findPlace(memory, " carrefour ")?.accountId).toBe("courant");
    expect(findPlace(memory, "carre")).toBeNull();
  });
  it("suggestions : préfixes puis contenus, hors correspondance exacte", () => {
    expect(suggestPlaces(memory, "car").map((m) => m.place)).toEqual(["Carrefour", "Carrefour City"]);
    expect(suggestPlaces(memory, "carrefour").map((m) => m.place)).toEqual(["Carrefour City"]);
    expect(suggestPlaces(memory, "bouil").map((m) => m.place)).toEqual(["Le Petit Bouillon"]);
  });
});
