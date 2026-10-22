import { describe, expect, it } from "vitest";
import {
  bankAccountLabel,
  counterpartyOf,
  findInternalAccount,
  guessAccountType,
  initialBalanceFor,
  interestReminder,
  matchesIdentifier,
  pickBalanceCents,
  toBankLines,
  type BankTransaction,
} from "./bank-sync";

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

describe("compte en face", () => {
  it("compte créditeur d'un débit, donneur d'ordre d'un crédit", () => {
    const out = tx({ creditor_account: { iban: "FR76 1070 7000 0012 3456 7890 123" }, debtor_account: { iban: "FR00MOI" } });
    const inc = tx({ credit_debit_indicator: "CRDT", creditor_account: { iban: "FR00MOI" }, debtor_account: { other: { identification: "12345678901" } } });
    expect(counterpartyOf(out)).toBe("FR7610707000001234567890123");
    expect(counterpartyOf(inc)).toBe("12345678901");
    expect(toBankLines([out])[0]!.counterparty).toBe("FR7610707000001234567890123");
    expect(counterpartyOf(tx())).toBeNull();
  });

  it("reconnaît le compte interne par IBAN ou par numéro de compte", () => {
    const iban = "FR7610707000001234567890123";
    expect(matchesIdentifier(iban, "fr76 1070 7000 0012 3456 7890 123")).toBe(true);
    expect(matchesIdentifier(iban, "12345678901")).toBe(true);
    expect(matchesIdentifier("12345678901", iban)).toBe(true);
    expect(matchesIdentifier(iban, "123")).toBe(false);
    expect(matchesIdentifier(null, iban)).toBe(false);
    expect(matchesIdentifier(iban, "99999999999")).toBe(false);
  });

  it("choisit l'identifiant le plus précis", () => {
    const accounts = [
      { id: "court", identifier: "10707" },
      { id: "long", identifier: "12345678901" },
    ];
    expect(findInternalAccount("FR7610707000001234567890123", accounts)?.id).toBe("long");
    expect(findInternalAccount("FR76000", accounts)).toBeNull();
  });
});

describe("interestReminder", () => {
  const livrets = [{ id: "a" }, { id: "b" }];
  it("hors période : rien", () => expect(interestReminder("2026-12-30", livrets, [])).toBeNull());
  it("le 31 décembre : tous les livrets de l'année", () => {
    expect(interestReminder("2026-12-31", livrets, [])).toEqual({ year: 2026, accounts: livrets });
  });
  it("en janvier : l'année précédente, sans les livrets déjà complétés", () => {
    const r = interestReminder("2027-01-10", livrets, [{ accountId: "a", date: "2026-12-31" }]);
    expect(r).toEqual({ year: 2026, accounts: [{ id: "b" }] });
  });
  it("plus de rappel une fois tout saisi", () => {
    expect(interestReminder("2027-01-02", livrets, [{ accountId: "a", date: "2026-12-31" }, { accountId: "b", date: "2027-01-01" }])).toBeNull();
  });
});

describe("bankAccountLabel", () => {
  it("préfère le produit, puis le libellé, jamais le nom du titulaire", () => {
    expect(bankAccountLabel({ product: "Livret A", details: "x" }, null)).toBe("Livret A");
    expect(bankAccountLabel({ details: "Compte de dépôt" }, null)).toBe("Compte de dépôt");
    expect(bankAccountLabel({}, "FR7612345678901234567890123")).toBe("Compte courant …0123");
    expect(bankAccountLabel({ cash_account_type: "SVGS" }, null)).toBe("Épargne");
  });
});

describe("guessAccountType", () => {
  it("reconnaît l'épargne", () => {
    expect(guessAccountType("Livret A")).toBe("savings");
    expect(guessAccountType("Compte de dépôt")).toBe("current");
    expect(guessAccountType(null)).toBe("current");
  });
});
