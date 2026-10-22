import { describe, expect, it } from "vitest";
import { guessAccountType, initialBalanceFor, pickBalanceCents, toBankLines, type BankTransaction } from "./bank-sync";

const tx = (over: Partial<BankTransaction> = {}): BankTransaction => ({
  entry_reference: "ref-1",
  transaction_amount: { amount: "12.50", currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status: "BOOK",
  booking_date: "2026-10-12",
  remittance_information: ["CARTE 10/10 CARREFOUR"],
  ...over,
});

describe("toBankLines", () => {
  it("signe les sorties et les entrées", () => {
    const lines = toBankLines([tx(), tx({ entry_reference: "ref-2", credit_debit_indicator: "CRDT", transaction_amount: { amount: "1527.03" } })]);
    expect(lines.map((l) => l.cents)).toEqual([-1250, 152703]);
  });

  it("ignore les écritures non comptabilisées, sans date ou à zéro", () => {
    const lines = toBankLines([
      tx({ status: "PDNG" }),
      tx({ entry_reference: "b", booking_date: null, value_date: null, transaction_date: null }),
      tx({ entry_reference: "c", transaction_amount: { amount: "0.00" } }),
    ]);
    expect(lines).toEqual([]);
  });

  it("prend la date de comptabilisation, à défaut la date de valeur", () => {
    expect(toBankLines([tx({ booking_date: null, value_date: "2026-10-11" })])[0]!.date).toBe("2026-10-11");
  });

  it("libellé : opération, à défaut contrepartie", () => {
    expect(toBankLines([tx()])[0]!.label).toBe("CARTE 10/10 CARREFOUR");
    expect(toBankLines([tx({ remittance_information: [], creditor: { name: "Boulangerie Paul" } })])[0]!.label).toBe("Boulangerie Paul");
    expect(toBankLines([tx({ remittance_information: null, creditor: null })])[0]!.label).toBe("Sans libellé");
  });

  it("référence propre à la banque, sinon dérivée et numérotée pour les écritures identiques", () => {
    expect(toBankLines([tx()])[0]!.ref).toBe("id:ref-1");
    const twin = { entry_reference: null, transaction_id: null };
    const [a, b] = toBankLines([tx(twin), tx(twin)]);
    expect(a!.ref).not.toBe(b!.ref);
    expect(toBankLines([tx(twin), tx(twin)]).map((l) => l.ref)).toEqual([a!.ref, b!.ref]);
  });
});

describe("pickBalanceCents", () => {
  it("préfère le solde de clôture", () => {
    const balances = [
      { balance_type: "ITAV", balance_amount: { amount: "1.00" } },
      { balance_type: "CLBD", balance_amount: { amount: "1234.56" } },
    ];
    expect(pickBalanceCents(balances)).toBe(123456);
  });
  it("renvoie null sans solde", () => expect(pickBalanceCents([])).toBeNull());
});

describe("initialBalanceFor", () => {
  it("fait coïncider solde Pecunia et solde bancaire", () => {
    expect(initialBalanceFor(100_000, -25_000)).toBe(125_000);
  });
});

describe("guessAccountType", () => {
  it("reconnaît l'épargne", () => {
    expect(guessAccountType("Livret A")).toBe("savings");
    expect(guessAccountType("Compte de dépôt")).toBe("current");
    expect(guessAccountType(null)).toBe("current");
  });
});
