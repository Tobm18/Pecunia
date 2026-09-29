import { describe, expect, it } from "vitest";
import { account, category } from "./__fixtures__";
import { DEFAULT_CATEGORIES } from "./defaults";
import {
  buildDrafts,
  columnsProblem,
  createCategorizer,
  decodeCsvBytes,
  dedupeKey,
  draftProblem,
  draftSignedCents,
  draftToItem,
  extractRows,
  fileBalances,
  findTransferLinks,
  guessColumns,
  guessTransferAccount,
  matchExisting,
  parseCsv,
  parseImportAmount,
  parseImportDate,
  type ExistingLine,
} from "./csv-import";

// Données fictives au format du tableur (un fichier par compte)
const COURANT = [
  "Raison;Date;Recette;Depense;Total",
  "Salaire ACME;02/01/2026;1 500,00 €;;1 534,60 €",
  "essence;02/01/2026;;62,00 €;1 472,60 €",
  "vers livretA;03/01/2026;;750,00 €;722,60 €",
  "livret A : recharge depuis livretA;11/01/2026;10,00 €;;732,60 €",
  "leclerc;11/01/2026;;54,82 €;677,78 €",
  "livret A : resto auron;18/01/2026;35,00 €;;712,78 €",
  "resto auron;18/01/2026;;35,00 €;677,78 €",
  "transport WER;14/07/2026;360,00 €;;1 037,78 €",
  " ;15/07/2026;;7,78 €;1 030,00 €",
  "",
].join("\r\n");

const LIVRET = [
  "Raison;Date;Recette;Depense;Total",
  "remunération nette;01/01/2026;66,04 €;;91,38 €",
  "vers livretA;03/01/2026;750,00 €;;841,38 €",
  "recharge compte courant;11/01/2026;;10,00 €;831,38 €",
  "resto auron;18/01/2026;;35,00 €;796,38 €",
  "transport WER;15/07/2026;;360,00 €;436,38 €",
  "cadeau mamie;16/07/2026;;20,00 €;416,38 €",
].join("\r\n");

const accounts = [
  account({ id: "cc", name: "Compte courant", type: "current" }),
  account({ id: "la", name: "Livret A", type: "savings", inBudget: false }),
  account({ id: "es", name: "Espèces", type: "cash" }),
];
const categories = DEFAULT_CATEGORIES.map((c, i) => category({ id: c.name, name: c.name, isIncome: !!c.isIncome, sortOrder: i }));

function load(text: string, fileIndex: number) {
  const parsed = parseCsv(text);
  return extractRows(parsed, guessColumns(parsed.header), fileIndex);
}

describe("décodage", () => {
  it("lit l'UTF-8 (avec BOM) et le Windows-1252 des exports Excel", () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("noël;12,00 €")]);
    expect(decodeCsvBytes(utf8)).toEqual({ text: "noël;12,00 €", encoding: "UTF-8" });
    // « noël;12,00 € » en Windows-1252 : ë = 0xEB, € = 0x80
    const cp1252 = new Uint8Array([0x6e, 0x6f, 0xeb, 0x6c, 0x3b, 0x31, 0x32, 0x2c, 0x30, 0x30, 0x20, 0x80]);
    expect(decodeCsvBytes(cp1252)).toEqual({ text: "noël;12,00 €", encoding: "Windows-1252" });
  });
});

describe("découpage et colonnes", () => {
  it("détecte le séparateur, les guillemets et les colonnes", () => {
    const parsed = parseCsv('Libellé,Date,Montant\n"Dîner, ""Léa""",2026-01-05,-12.5\n');
    expect(parsed.separator).toBe(",");
    expect(parsed.rows[0]!.cells).toEqual(['Dîner, "Léa"', "2026-01-05", "-12.5"]);
    expect(guessColumns(parsed.header)).toEqual(["label", "date", "amount"]);
    expect(guessColumns(["Raison", "Date", "Recette", "Depense", "Total"])).toEqual(["label", "date", "credit", "debit", "balance"]);
  });

  it("signale les colonnes manquantes", () => {
    expect(columnsProblem(["label", "date", "credit", "debit"])).toBeNull();
    expect(columnsProblem(["label", "credit"])).toMatch(/Date/);
    expect(columnsProblem(["date", "label", "balance"])).toMatch(/Montant/);
  });

  it("lit montants et dates au format français", () => {
    expect(parseImportAmount("1 527,03 €")).toBe(152703);
    expect(parseImportAmount("-0,25 €")).toBe(-25);
    expect(parseImportAmount("1.527,03")).toBe(152703);
    expect(parseImportAmount("(12,50)")).toBe(-1250);
    expect(parseImportAmount("")).toBeNull();
    expect(parseImportDate("02/01/2026")).toBe("2026-01-02");
    expect(parseImportDate("2/1/26")).toBe("2026-01-02");
    expect(parseImportDate("2026-01-02")).toBe("2026-01-02");
    expect(parseImportDate("31/02/2026")).toBeNull();
  });
});

describe("lignes et soldes", () => {
  it("normalise les lignes, garde un libellé par défaut", () => {
    const { rows, errors } = load(COURANT, 0);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(9);
    expect(rows[0]).toMatchObject({ date: "2026-01-02", label: "Salaire ACME", cents: 150000, balanceCents: 153460 });
    expect(rows[1]!.cents).toBe(-6200);
    expect(rows[8]!.label).toBe("Sans libellé");
  });

  it("signale les lignes illisibles sans bloquer les autres", () => {
    const { rows, errors } = load("Raison;Date;Recette;Depense\nok;01/01/2026;;5,00\nko;32/01/2026;;5,00\nvide;02/01/2026;;\n", 0);
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it("déduit le solde d'ouverture et vérifie le solde final", () => {
    const { rows } = load(COURANT, 0);
    expect(fileBalances(rows)).toEqual({
      opening: { cents: 3460, date: "2026-01-02" },
      closingFromFile: 103000,
      closingComputed: 103000,
    });
  });
});

describe("virements devinés et lignes déjà enregistrées", () => {
  it("reconnaît l'autre compte dans le libellé", () => {
    expect(guessTransferAccount("vers livretA", accounts, "cc")?.id).toBe("la");
    expect(guessTransferAccount("livret A : essence", accounts, "cc")?.id).toBe("la");
    expect(guessTransferAccount("recharge compte courant", accounts, "la")?.id).toBe("cc");
    expect(guessTransferAccount("retrait especes", accounts, "cc")?.id).toBe("es");
    expect(guessTransferAccount("vers livretA", accounts, "la")).toBeNull(); // jamais le compte importé
    expect(guessTransferAccount("essence", accounts, "cc")).toBeNull();
  });

  it("repère une ligne existante : même jour, ou ±3 jours pour un virement", () => {
    const existing: ExistingLine[] = [
      { id: "e1", accountId: "la", date: "2026-01-18", amountCents: -5800, type: "transfer", place: "livret A : essence", counterpartAccountId: "cc" },
      { id: "e2", accountId: "la", date: "2026-01-03", amountCents: 75000, type: "transfer", place: "vers livretA", counterpartAccountId: "cc" },
      { id: "e3", accountId: "la", date: "2026-02-02", amountCents: -2000, type: "out", place: "cadeau", counterpartAccountId: null },
    ];
    const matches = matchExisting(
      [
        { key: "a", date: "2026-01-17", cents: -5800 }, // virement daté du lendemain de l'autre côté
        { key: "b", date: "2026-01-03", cents: 75000 },
        { key: "c", date: "2026-02-01", cents: -2000 }, // pas un virement : écart refusé
        { key: "d", date: "2026-01-03", cents: 75000 }, // déjà utilisée par « b »
      ],
      existing,
    );
    expect([...matches.entries()].map(([k, e]) => [k, e.id])).toEqual([
      ["b", "e2"],
      ["a", "e1"],
    ]);
  });
});

describe("catégorisation", () => {
  it("applique la mémoire des lieux puis les mots-clés, sinon « Autres »", () => {
    const categorizer = createCategorizer(categories, [
      { place: "Chez Paulo", categoryId: "Restaurants", accountId: "cc", lastUsed: "2026-01-01" },
    ]);
    expect(categorizer.categoryFor("chez paulo", "out")).toBe("Restaurants");
    expect(categorizer.categoryFor("essence", "out")).toBe("Transport");
    expect(categorizer.categoryFor("Carrrefour", "out")).toBe("Courses");
    expect(categorizer.categoryFor("uber eats", "out")).toBe("Restaurants");
    expect(categorizer.categoryFor("uber", "out")).toBe("Transport");
    expect(categorizer.categoryFor("icloud", "out")).toBe("Abonnements");
    expect(categorizer.categoryFor("Loyer", "out")).toBe("Logement");
    expect(categorizer.categoryFor("pharmacie", "out")).toBe("Santé");
    expect(categorizer.categoryFor("tony coiffeur", "out")).toBe("Autres");
    // recettes : seulement une catégorie de revenu, sinon « Autres »
    expect(categorizer.categoryFor("Salaire ACME", "in")).toBe("Salaire");
    expect(categorizer.categoryFor("Prime d'activité", "in")).toBe("Salaire");
    expect(categorizer.categoryFor("maif - remboursement", "in")).toBe("Autres");
  });
});

describe("brouillon et plan d'import", () => {
  const categorizer = createCategorizer(categories, []);
  const courant = load(COURANT, 0).rows;
  const drafts = buildDrafts({ rows: courant, account: accounts[0]!, accounts, categorizer, existing: [] });
  const find = (label: string) => drafts.find((d) => d.label === label)!;

  it("devine types, virements et catégories", () => {
    expect(find("Salaire ACME")).toMatchObject({ type: "in", categoryId: "Salaire", amount: "1500,00", include: true });
    expect(find("essence")).toMatchObject({ type: "out", categoryId: "Transport" });
    expect(find("vers livretA")).toMatchObject({ type: "transfer_out", counterpartId: "la", categoryId: null });
    expect(find("livret A : resto auron")).toMatchObject({ type: "transfer_in", counterpartId: "la" });
    expect(find("transport WER")).toMatchObject({ type: "in" }); // aucun compte nommé : à ajuster à la main
  });

  it("détecte les intérêts sur un compte d'épargne", () => {
    const livret = buildDrafts({ rows: load(LIVRET, 1).rows, account: accounts[1]!, accounts, categorizer, existing: [] });
    expect(livret.find((d) => d.label === "remunération nette")).toMatchObject({ type: "interest", categoryId: null });
    expect(livret.find((d) => d.label === "recharge compte courant")).toMatchObject({ type: "transfer_out", counterpartId: "cc" });
  });

  it("exclut par défaut les lignes déjà enregistrées", () => {
    const withExisting = buildDrafts({
      rows: courant,
      account: accounts[0]!,
      accounts,
      categorizer,
      existing: [{ id: "x", accountId: "cc", date: "2026-01-03", amountCents: -75000, type: "transfer", place: "vers livretA", counterpartAccountId: "la" }],
    });
    expect(withExisting.find((d) => d.label === "vers livretA")).toMatchObject({ include: false, existing: { date: "2026-01-03" } });
    expect(withExisting.filter((d) => !d.include)).toHaveLength(1);
  });

  it("valide chaque ligne", () => {
    const base = find("essence");
    expect(draftProblem(base, "cc")).toBeNull();
    expect(draftProblem({ ...base, amount: "" }, "cc")).toBe("Montant requis");
    expect(draftProblem({ ...base, categoryId: null }, "cc")).toBe("Catégorie requise");
    expect(draftProblem({ ...base, label: " " }, "cc")).toBe("Libellé requis");
    expect(draftProblem({ ...base, date: "2026-13-01" }, "cc")).toBe("Date invalide");
    expect(draftProblem({ ...base, type: "transfer_out", counterpartId: null }, "cc")).toBe("Choisis l'autre compte");
    expect(draftProblem({ ...base, type: "transfer_out", counterpartId: "cc" }, "cc")).toBe("Choisis un autre compte");
  });

  it("produit des éléments orientés source → destination et conserve le solde du fichier", () => {
    expect(draftToItem(find("vers livretA"), "cc")).toMatchObject({ kind: "transfer", accountId: "cc", toAccountId: "la", amountCents: 75000 });
    expect(draftToItem(find("livret A : resto auron"), "cc")).toMatchObject({ kind: "transfer", accountId: "la", toAccountId: "cc", amountCents: 3500 });
    expect(draftToItem(find("leclerc"), "cc")).toMatchObject({ kind: "out", categoryId: "Courses", amountCents: 5482 });
    const total = drafts.reduce((s, d) => s + draftSignedCents(d), 0);
    expect(total).toBe(courant.reduce((s, r) => s + r.cents, 0));
  });
});

describe("dedupeKey", () => {
  it("ignore casse, accents et espaces du libellé", () => {
    expect(dedupeKey("cc", "2026-01-01", -500, " Noël ")).toBe(dedupeKey("cc", "2026-01-01", -500, "noel"));
  });
});

describe("virements reliés à une ligne existante de l'autre compte", () => {
  const categorizer = createCategorizer(categories, []);
  // Import du livret après le courant : le courant contient déjà « recharge » +100 € en simple entrée
  const livret = load(
    ["Raison;Date;Recette;Depense;Total", "recharge compte courant;23/06/2026;;100,00 €;900,00 €", "recharge compte courant;30/06/2026;;10,00 €;890,00 €"].join("\n"),
    1,
  ).rows;
  const drafts = buildDrafts({ rows: livret, account: accounts[1]!, accounts, categorizer, existing: [] });
  const otherLines: ExistingLine[] = [
    { id: "cc-recharge-100", accountId: "cc", date: "2026-06-23", amountCents: 10000, type: "in", place: "recharge", counterpartAccountId: null },
    { id: "cc-virement-10", accountId: "cc", date: "2026-06-30", amountCents: 1000, type: "transfer", place: "livret", counterpartAccountId: "la" },
    { id: "es-100", accountId: "es", date: "2026-06-23", amountCents: 10000, type: "in", place: "autre compte", counterpartAccountId: null },
  ];

  it("relie le virement à l'entrée déjà saisie sur le compte courant (pas de doublon)", () => {
    const links = findTransferLinks(drafts, otherLines);
    expect(links.get(drafts[0]!.key)?.id).toBe("cc-recharge-100");
    // une ligne déjà virement n'est jamais reliée ; un autre compte non plus
    expect(links.has(drafts[1]!.key)).toBe(false);
    expect(draftToItem(drafts[0]!, "la", links.get(drafts[0]!.key)!.id)).toMatchObject({
      kind: "transfer",
      accountId: "la",
      toAccountId: "cc",
      amountCents: 10000,
      linkId: "cc-recharge-100",
    });
  });

  it("n'utilise une ligne existante qu'une fois et ignore les lignes exclues", () => {
    const twice = [drafts[0]!, { ...drafts[0]!, key: "copie" }];
    expect(findTransferLinks(twice, otherLines).size).toBe(1);
    expect(findTransferLinks([{ ...drafts[0]!, include: false }], otherLines).size).toBe(0);
  });

  it("accepte ±3 jours et exige un montant opposé exact", () => {
    expect(findTransferLinks([{ ...drafts[0]!, date: "2026-06-25" }], otherLines).size).toBe(1);
    expect(findTransferLinks([{ ...drafts[0]!, date: "2026-06-27" }], otherLines).size).toBe(0);
    expect(findTransferLinks([{ ...drafts[0]!, amount: "99,99" }], otherLines).size).toBe(0);
  });
});
