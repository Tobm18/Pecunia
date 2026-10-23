import { describe, expect, it } from "vitest";
import { category } from "./__fixtures__";
import { DEFAULT_CATEGORIES } from "./defaults";
import { CATEGORY_RULES, directoryMatchScore, merchantKey, merchantPlace, merchantRoot, nafCategoryName, needsReview, ruleCategoryNames, SUGGESTED_CATEGORIES } from "./categorize";
import { createCategorizer } from "./csv-import";

describe("merchantKey", () => {
  it.each([
    ["171026 CB****3007 DECATHLON 06GRASSE", "decathlon"],
    ["111026 CB****3007 ESCOTA ANTIBES 06MANDELIEU LA", "escota antibes"],
    ["171026 CB****3007 SAS HYPER GRASS06GRASSE", "hyper grass"],
    ["051026 CB****3007 ANTHROPIC* CLAUUS ANTHROPIC.CO 21,60EUR 1 EURO = 1,000000", "anthropic clauus anthropic co"],
    ["240926 CB****3007 PBP_NICE FR 92BOULOGNE-B 2,40EUR 1 EURO = 1,000000", "pbp nice"],
    ["PRLV SEPA PayPal Europe 1053685047143/PAYPAL 5BEJ2255QEQJ6", "prlv paypal europe"],
    ["PRLV SEPA GAN ASS ENC PR P117800536 71922671200023", "prlv gan ass enc"],
    ["VIR INST WERO TOM GUIDAR 01a130020b5d7db49160945e0b9326f4 madere", "wero tom guidar"],
    ["VIR INST ENVOI WERO TOM 01a0e9ff98ac7e6087e14549446e3e66 NOTPROVIDED", "wero tom"],
    ["COTIS CRISTAL ESSENTIEL XCCNV084 2026101300005952000001 CONTRAT", "cotis cristal essentiel"],
    ["290926 CB****3007 AMAZON PAYMENTSPARIS2441535/", "amazon"],
    ["Courses Leclerc", "courses leclerc"],
  ])("%s → %s", (label, key) => expect(merchantKey(label)).toBe(key));

  it("export CSV (carte en fin de libellé) et synchronisation donnent la même clé", () => {
    expect(merchantKey("GARIG 06CAGNES SUR ME 260326 CB****3007")).toBe("garig");
    expect(merchantKey("260326 CB****3007 GARIG 06CAGNES SUR ME")).toBe("garig");
    expect(merchantKey("GARIG FR CAGNES SUR M 190226 CB****3007-20,00EUR 1 EURO = 1,000000")).toBe("garig");
    expect(merchantKey("SPORT OLYMPIQUEFR MALLEMORT 310525 CB****1798-4,00EUR 1 EURO")).toBe("sport olympique");
    expect(merchantKey("4PETROLI IT PIEVE A NIEV 270626 CB****3007-74,72EUR 1 EURO =")).toBe("petroli");
    expect(merchantKey("VIR M BALLESTER LUC Virement de M Tom Ballester-Virement de")).toBe("vir ballester luc");
  });

  it("même commerçant, autre jour et autre ville : même clé", () => {
    expect(merchantKey("091026 CB****3007 MY BEERS 06GRASSE")).toBe(merchantKey("101026 CB****3007 MY BEERS 06NICE"));
  });

  it("racine d'une clé", () => {
    expect(merchantRoot("escota antibes")).toBe("escota");
    expect(merchantRoot("wero tom guidar")).toBe(null);
    expect(merchantRoot("prlv paypal europe")).toBe("paypal");
  });
});

describe("règles", () => {
  it("chaque règle vise une catégorie par défaut ou proposée", () => {
    const names = new Set([...DEFAULT_CATEGORIES.map((c) => c.name), ...SUGGESTED_CATEGORIES.map((c) => c.name)]);
    for (const [name] of CATEGORY_RULES) expect(names.has(name)).toBe(true);
  });

  it("reconnaît des commerçants courants", () => {
    expect(ruleCategoryNames("111026 CB****3007 ESCOTA ANTIBES 06MANDELIEU LA")[0]).toBe("Transport");
    expect(ruleCategoryNames("PRLV SEPA GAN ASS ENC PR P117800536")[0]).toBe("Assurances");
    expect(ruleCategoryNames("COTIS CRISTAL ESSENTIEL XCCNV084")[0]).toBe("Frais bancaires");
    expect(ruleCategoryNames("151026 CB****3007 WEB AMENDE.GOUV35RENNES")[0]).toBe("Impôts & amendes");
    expect(ruleCategoryNames("ASSOC DE PROTECTION SOCI PAIEMENT SEPTEMBRE2026")[0]).toBe("Salaire");
  });
});

describe("apprentissage", () => {
  const categories = [
    ...DEFAULT_CATEGORIES.map((c, i) => category({ id: c.name, name: c.name, isIncome: !!c.isIncome, sortOrder: i })),
    category({ id: "Shopping", name: "Shopping" }),
  ];

  it("une catégorie choisie pour un commerçant vaut pour toutes ses lignes", () => {
    const c = createCategorizer(categories, [], [{ merchantKey: "my beers", categoryId: "Restaurants" }]);
    expect(c.categoryFor("101026 CB****3007 MY BEERS 06NICE", "out")).toBe("Restaurants");
  });

  it("une règle apprise par racine couvre les variantes (péages ESCOTA)", () => {
    const c = createCategorizer(categories, [], [{ merchantKey: "escota capitou", categoryId: "Loisirs" }]);
    expect(c.categoryFor("041026 CB****3007 ESCOTA SOPHIA 06MANDELIEU LA", "out")).toBe("Loisirs");
  });

  it("une mémoire « Autres » ne compte pas ; la règle de mots-clés s'applique", () => {
    const c = createCategorizer(categories, [{ place: "171026 CB****3007 DECATHLON 06GRASSE", categoryId: "Autres", accountId: "cc", lastUsed: "2026-10-17" }]);
    expect(c.categoryFor("181026 CB****3007 DECATHLON 06NICE", "out")).toBe("Shopping");
  });

  it("la mémoire d'un commerçant (vraie catégorie) s'applique à ses autres lignes", () => {
    const c = createCategorizer(categories, [{ place: "091026 CB****3007 LA BRIGADE 06CAGNES", categoryId: "Restaurants", accountId: "cc", lastUsed: "2026-10-09" }]);
    expect(c.categoryFor("300926 CB****3007 LA BRIGADE 06CAGNES-SUR-ME", "out")).toBe("Restaurants");
  });

  it("sans indice : repli « Autres », et confidentCategoryFor renvoie null", () => {
    const c = createCategorizer(categories, []);
    expect(c.categoryFor("XYZ INCONNU", "out")).toBe("Autres");
    expect(c.confidentCategoryFor("XYZ INCONNU", "out")).toBeNull();
  });
});

describe("annuaire des entreprises", () => {
  it("code NAF → catégorie", () => {
    expect(nafCategoryName("56.29B")).toBe("Restaurants");
    expect(nafCategoryName("47.11F")).toBe("Courses");
    expect(nafCategoryName("47.73Z")).toBe("Santé");
    expect(nafCategoryName("47.30Z")).toBe("Transport");
    expect(nafCategoryName("93.29Z")).toBe("Loisirs");
    expect(nafCategoryName("96.02A")).toBeNull();
  });

  it("commerçant d'un paiement carte : nom, département, ville", () => {
    expect(merchantPlace("260326 CB****3007 GARIG 06CAGNES SUR ME")).toEqual({ name: "garig", department: "06", city: "cagnes sur me" });
    expect(merchantPlace("GARIG 06CAGNES SUR ME 260326 CB****3007")).toEqual({ name: "garig", department: "06", city: "cagnes sur me" });
    expect(merchantPlace("NEW PADDOCK FR GRASSE 121225 CB****1798-60,80EUR 1 EURO = 1,")).toEqual({ name: "new paddock", department: null, city: "grasse" });
    expect(merchantPlace("PRLV SEPA PayPal Europe 1053685047143/PAYPAL")).toBeNull();
  });

  it("qualité de la correspondance", () => {
    const place = { name: "garig", city: "cagnes sur me" };
    expect(directoryMatchScore(place, { names: ["GARIG"], communes: ["CAGNES-SUR-MER", "NICE"] })).toBe(90);
    // homonyme ailleurs : sous le seuil, à vérifier
    expect(directoryMatchScore(place, { names: ["GARIG"], communes: ["LYON"] })).toBeLessThan(70);
    expect(directoryMatchScore({ ...place, department: "06" }, { names: ["CONCORDE"], communes: ["VALLAURIS"] })).toBe(0);
    expect(directoryMatchScore({ name: "concorde", city: "cagnes sur me", department: "06" }, { names: ["CONCORDE"], communes: ["VALLAURIS"] })).toBeLessThan(70);
    expect(directoryMatchScore({ name: "la petite sourc", city: "mandelieu la" }, { names: ["LA SOURCE"], communes: ["MANDELIEU LA NAPOULE"] })).toBeLessThan(80);
    expect(directoryMatchScore(place, { names: ["BOULANGERIE MARTIN"], communes: ["CAGNES-SUR-MER"] })).toBe(0);
  });

  it("le catégoriseur s'en sert, avec le score de la correspondance", () => {
    const cats = DEFAULT_CATEGORIES.map((c, i) => category({ id: c.name, name: c.name, isIncome: !!c.isIncome, sortOrder: i }));
    const c = createCategorizer(cats, [], [], new Map([["garig|06", { naf: "56.29B", score: 90 }]]));
    expect(c.classify("260326 CB****3007 GARIG 06CAGNES SUR ME", "out")).toEqual({ categoryId: "Restaurants", confidence: 90, source: "directory" });
    expect(c.classify("XYZ INCONNU", "out")).toEqual({ categoryId: "Autres", confidence: 0, source: "fallback" });
    expect(c.classify("111026 CB****3007 ESCOTA ANTIBES 06MANDELIEU LA", "out")).toMatchObject({ categoryId: "Transport", source: "rule" });
  });

  it("à vérifier : automatique sous le seuil, jamais une saisie manuelle", () => {
    expect(needsReview("fallback", 0)).toBe(true);
    expect(needsReview("directory", 65)).toBe(true);
    expect(needsReview("rule", 75)).toBe(false);
    expect(needsReview("manual", 0)).toBe(false);
    expect(needsReview(null, null)).toBe(false);
  });
});
