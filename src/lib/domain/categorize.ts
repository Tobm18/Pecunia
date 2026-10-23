/**
 * Catégorisation des transactions - logique pure, sans IA.
 *
 * 1. Clé commerçant : un libellé bancaire (« 171026 CB****3007 DECATHLON 06GRASSE ») est ramené
 *    au commerçant (« decathlon ») ; date, carte, ville et références disparaissent. Toutes les
 *    lignes d'un même commerçant partagent ainsi la même clé.
 * 2. Apprentissage : une catégorie choisie à la main pour un commerçant vaut pour toutes ses lignes,
 *    passées et à venir (règles « commerçant → catégorie » enregistrées par utilisateur).
 * 3. Règles par mots-clés vers des noms de catégories, dont certaines à créer (proposées).
 */

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Mots sans valeur pour reconnaître un commerçant (formes juridiques, articles…) */
const STOPWORDS = new Set(["sas", "sarl", "sa", "eurl", "sc", "sci", "snc", "the", "le", "la", "les", "de", "du", "des", "et", "e", "fr", "eu", "mr", "mme", "mlle", "melle", "mle"]);

/**
 * Clé commerçant d'un libellé (minuscules, sans accents), stable d'une ligne à l'autre :
 *   « 171026 CB****3007 DECATHLON 06GRASSE »           → « decathlon »
 *   « 111026 CB****3007 ESCOTA ANTIBES 06MANDELIEU LA » → « escota antibes »
 *   « PRLV SEPA PayPal Europe 1053685047143/PAYPAL »    → « prlv paypal europe »
 *   « VIR INST WERO TOM GUIDAR 01a130020b… madere »     → « wero tom guidar »
 *   « COTIS CRISTAL ESSENTIEL XCCNV084 2026… »          → « cotis cristal essentiel »
 */
export function merchantKey(label: string | null | undefined): string {
  let s = normalize(label ?? "");
  // paiement carte : « jjmmaa CB****1234 » en tête (synchronisation) ou en fin (export CSV, suivi du montant)
  s = s.replace(/^\d{6}\s+cb\s*\*+\s*\d{2,4}\s*/, "");
  s = s.replace(/\s\d{6}\s+cb\s*\*+\s*\d{2,4}.*$/, "");
  // conversion de devise et montant d'origine (« 21,60eur 1 euro = 1,0… »)
  s = s.replace(/\s\d+[.,]\d{2}\s?eur\b.*$/, "");
  // département et ville collés au commerçant (« grass06grasse », « 06mandelieu »)
  s = s.replace(/^(.{3,}?)\s?\d{2}[a-z][a-z\s'-]*$/, "$1");
  let prefix = "";
  if (/^prlv\s+sepa\s+/.test(s)) {
    prefix = "prlv ";
    s = s.replace(/^prlv\s+sepa\s+/, "");
  } else if (/^vir(\s+inst)?\s+/.test(s)) {
    s = s.replace(/^vir(\s+inst)?\s+/, "");
    if (/^(envoi\s+)?wero\s+/.test(s)) {
      prefix = "wero ";
      s = s.replace(/^(envoi\s+)?wero\s+/, "");
    } else {
      prefix = "vir ";
      // « Virement vers Mlle Chou », « Vir. vers M » : le destinataire suit (souvent tronqué, parfois absent)
      s = s.replace(/^(virement|vir\.?)\s+vers\s+/, "");
    }
  }
  // virement à une personne : le motif répété (« Virement de M Tom Ballester ») n'est pas le nom
  s = s.replace(/\s(virement|vir\.?)\s(de|vers)\b.*$/, "");
  const words: string[] = [];
  for (const raw of s.split(/[\s/*.,;:_()'"-]+/)) {
    if (!raw) continue;
    if (/\d/.test(raw)) {
      // « face06 », « 4petroli » : un nom collé à des chiffres reste le nom ; sinon référence, numéro, date : fin du nom
      const letters = raw.replace(/^\d+/, "").replace(/\d.*$/, "");
      if (!words.length && letters.length >= 3) words.push(letters);
      break;
    }
    // pays : « FR » seul ou collé au nom (« pegofr pegomas ») ; la ville qui suit n'est pas le nom
    if (raw === "fr" && words.length) break;
    if ((words.length ? raw.length > 4 : raw.length > 6) && raw.endsWith("fr")) {
      words.push(raw.slice(0, -2));
      break;
    }
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    words.push(raw);
    if (words.length === (prefix ? 3 : 4)) break;
  }
  return (prefix + words.join(" ")).trim();
}

/** Premier mot significatif d'une clé (« escota » pour « escota antibes »), hors préfixe. */
export function merchantRoot(key: string): string | null {
  const word = key.replace(/^(prlv|wero|vir)\s+/, "").split(" ")[0] ?? "";
  return word.length >= 4 ? word : null;
}

export interface SuggestedCategory {
  name: string;
  icon: string;
  color: string;
  isIncome: boolean;
}

/** Catégories proposées quand des transactions leur correspondent et qu'elles n'existent pas encore. */
export const SUGGESTED_CATEGORIES: SuggestedCategory[] = [
  { name: "Bar", icon: "beer", color: "#e0a030", isIncome: false },
  { name: "Shopping", icon: "bag", color: "#5b6bd6", isIncome: false },
  { name: "Assurances", icon: "shield", color: "#2f3a4f", isIncome: false },
  { name: "Frais bancaires", icon: "bank", color: "#c0504d", isIncome: false },
  { name: "Impôts & amendes", icon: "receipt", color: "#e08a2e", isIncome: false },
  { name: "Associations & dons", icon: "donate", color: "#7cb860", isIncome: false },
  { name: "Virements à des proches", icon: "users", color: "#8b7fd6", isIncome: false },
  { name: "Retraits d'espèces", icon: "wallet", color: "#a89f91", isIncome: false },
  { name: "Remboursements", icon: "refund", color: "#4bb3c8", isIncome: true },
];

/**
 * Règles par mots-clés (texte sans accents, en minuscules), vers des noms de catégories. L'ordre
 * compte : la première règle dont la catégorie existe et convient au sens (dépense / recette)
 * l'emporte ; une règle visant une catégorie absente laisse passer aux suivantes.
 */
export const CATEGORY_RULES: [string, RegExp][] = [
  ["Salaire", /salaire|paie\b|prime d.activite|mobilijeune|\bcaf\b|13 ?e?me mois|allocation|pole emploi|france travail|paiement (janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)/],
  ["Remboursements", /\bwero\b|lydia|paylib|rembourse|\brbt\b|\bremb\b|\bcpam\b|ameli|mutuelle|virement de|vir\.? de\b/],
  ["Assurances", /assurance|\bassur\b|gan ass|\bmaif\b|macif|matmut|\baxa\b|allianz|groupama|\bmma\b|generali|direct assurance|opteven|\bluko\b|\balan\b|leocare/],
  ["Frais bancaires", /\bcotis|cotisation|\bfrais\b|commission|agios|cristal|tenue de compte|interets debiteurs|offre groupee/],
  ["Impôts & amendes", /amende|\bantai\b|\bimpot|dgfip|tresor public|\btaxe\b|urssaf|fourriere/],
  ["Retraits d'espèces", /\bret dab\b|retrait|\bdab\b|distributeur/],
  ["Virements à des proches", /\bwero\b|lydia|envoi wero|virement vers|vir\.? vers|^vir (inst )?(m|mme|mlle|mr|melle)\.? /],
  // bars avant les restaurants ; sans catégorie « Bar », ils retombent dans « Restaurants »
  ["Bar", /\bbar\b|\bpub\b|beers?\b|biere|brasserie|brasseu|brewdog|tapas|delirium|sunbar|barstool|guinguette|cocktail|lounge|\bcaves?\b|taverne|irish/],
  ["Restaurants", /uber ?eats|deliveroo|just eat|resto|restau|ristorante|osteria|trattoria|pizz|burger|kfc|mcdo|mc ?donald|five guys|subway|kebab|sushi|cafet|\bcafe\b|coffee|coffe|\bbar\b|brasserie|brasseur|pub\b|creperie|crepes?\b|snack|gelateria|glacier|boulangerie|boul\b|viennoiserie|patisserie|beers?\b|biere|tapas|bistro|cantine|crous|bateleur|delirium|naga|sunbar|barstool|guinguette|gourmand|bouf+e?\b|miam\b|carte tr\b|ticket resto|traiteur|starbucks|columbus|paul\b|brioche doree|izly|smoney|fournil|naan|curry|\brest\b|bistrot|brasseu|\bchez\b|kiosque|glaces?\b|food|grill|wok|ramen|poke|tacos|o.tacos/],
  ["Courses", /carr+efour|leclerc|intermarche|lidl|aldi|monoprix|franprix|auchan|casino|super ?u\b|hyper|superstore|biocoop|picard|grand frais|netto|leader price|spar\b|vival|cocci|proxi\b|\bg20\b|bio c bon|naturalia|la vie claire|asia market|market\b|primeur|boucherie|fromagerie|too good to go|marche\b|epicerie|drive\b|supermarche/],
  ["Transport", /essence|carburant|gasoil|diesel|petrol|station|pbp_|peage|telepeage|autoroute|escota|vinci autoroute|\baprr\b|sanef|\basf\b|\batmb\b|\barea\b|sitaf|cofiroute|parking|parcheggio|stationnement|paybyphone|easypark|\bpbp\b|indigo|effia|saemes|q.park|onepark|keolis|\btfl\b|reseau mistral|zou\b|envibus|palmbus|\btotal\b|sncf|ouigo|\btgv\b|\bter\b|flixbus|blablacar|\buber\b|bolt|taxi|\bvtc\b|metro|\bbus\b|lignes d.azur|tisseo|navigo|ratp|tram|train|avion|ryanair|easyjet|transavia|velo|ridemovi|lime\b|garage|carwash|lavage|controle technique|securitest|dekra|autosur|pneu|norauto|feu vert|midas|speedy|total ?energies|\besso\b|\bavia\b|shell|dyneff/],
  ["Abonnements", /icloud|apple\.com|netflix|spotify|disney|amazon prime|prime video|deezer|canal\+?|free mobile|\bsfr\b|orange|bouygues|claude|anthropic|chatgpt|openai|openrouter|github|notion|google|youtube|microsoft|adobe|canva|dropbox|ionos|\bovh\b|fitness|basic.?fit|salle de sport|abonnement|forfait mobile/],
  ["Santé", /pharmacie|pharma\b|medecin|docteur|\bdr\b|doctolib|ophtalmo|dentiste|dentaire|kine|osteo|optique|opticien|lunettes|hopital|clinique|laboratoire/],
  ["Logement", /loyer|\bedf\b|engie|electricite|\beau\b|assurance habitation|charges|syndic|internet|\bbox\b|ikea|leroy merlin|castorama|brico|laverie|pressing|machines/],
  ["Associations & dons", /hello ?asso|wikimedia|\bdons?\b|croix.rouge|unicef|restos du coeur|telethon|association|\bbde\b/],
  ["Shopping", /amazon|cdiscount|\bfnac\b|darty|boulanger\b|zalando|shein|aliexpress|\btemu\b|vinted|ebay|leboncoin|\bzara\b|\bh ?& ?m\b|kiabi|primark|uniqlo|\baction\b|gifi|la foir|maisons du monde|sephora|nocibe|decathlon|intersport|go sport|vape|tabac|relay|relais h|\bjules\b|celio|bershka|pull ?and ?bear|\bcewe\b|phone|apple store|micromania|king jouet|fleur/],
  ["Loisirs", /bowling|cinema|\bcine\b|escape|billard|laser|lazer|concert|festiva|spectacle|weezevent|billetterie|ticketmaster|musee|aqua|padel|loisirs|\bski\b|forfait|location|parachute|skydive|jeux?\b|steam|cultura|voyage|airbnb|hotel|booking|linkin|soiree|tower|zoo|parc\b/],
];

/** Noms de catégories proposés par les règles pour un libellé, dans l'ordre de priorité. */
export function ruleCategoryNames(label: string): string[] {
  const text = normalize(label);
  return CATEGORY_RULES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Catégorie d'un nom (sans accents ni casse). */
export const categoryNameKey = (name: string) => normalize(name);

/** Règle apprise : toutes les lignes d'un commerçant vont dans cette catégorie. */
export interface MerchantRule {
  merchantKey: string;
  categoryId: string;
}

// ---------------------------------------------------------------------------
// Annuaire des entreprises (base SIRENE) : code d'activité NAF → catégorie
// ---------------------------------------------------------------------------

/**
 * Catégorie d'un code NAF (« 56.10A »), du plus précis au plus large. null : activité sans
 * catégorie évidente (coiffure, services divers…), la ligne reste à vérifier.
 */
const NAF_RULES: [RegExp, string][] = [
  [/^47\.73/, "Santé"], // pharmacie
  [/^47\.74/, "Santé"], // matériel médical
  [/^47\.78A/, "Santé"], // opticien
  [/^47\.30/, "Transport"], // carburant
  [/^47\.26/, "Shopping"], // tabac
  [/^47\.24/, "Restaurants"], // boulangerie, pâtisserie (comme les règles par mots-clés)
  [/^10\.71/, "Restaurants"], // boulangerie-pâtisserie artisanale
  [/^47\.(11|2)/, "Courses"], // supermarchés, alimentation spécialisée
  [/^47\.91/, "Shopping"], // vente à distance
  [/^47\./, "Shopping"], // autres commerces de détail
  [/^56\.30/, "Bar"], // débits de boissons
  [/^56\./, "Restaurants"], // restauration
  [/^(49|50|51)\./, "Transport"], // transports
  [/^52\.2/, "Transport"], // autoroutes, parkings, gares
  [/^45\.(2|3)/, "Transport"], // entretien et pièces auto
  [/^77\.11/, "Transport"], // location de voitures
  [/^(86|75)\./, "Santé"], // santé humaine, vétérinaires
  [/^(55|79|90|91|92|93)\./, "Loisirs"], // hébergement, voyages, spectacles, musées, jeux, sport et loisirs
  [/^59\.14/, "Loisirs"], // cinémas
  [/^61\./, "Abonnements"], // télécommunications
  [/^(35|36|68)\./, "Logement"], // énergie, eau, immobilier
  [/^65\./, "Assurances"],
  [/^64\.1/, "Frais bancaires"],
  [/^84\./, "Impôts & amendes"], // administration publique
  [/^94\./, "Associations & dons"],
];

export function nafCategoryName(naf: string | null | undefined): string | null {
  if (!naf) return null;
  return NAF_RULES.find(([re]) => re.test(naf))?.[1] ?? null;
}

/** Paiement par carte (« CB****1234 ») : seul cas où le commerçant est cherché dans l'annuaire. */
export const isCardPayment = (label: string | null | undefined) => /\bcb\s*\*{2,}\s*\d{2,4}\b/i.test(label ?? "");

/**
 * Commerçant d'un paiement carte, pour l'annuaire : nom (clé commerçant), département et ville
 * quand le libellé les donne (« … GARIG 06CAGNES SUR ME » → garig, 06, cagnes sur me).
 */
export function merchantPlace(label: string | null | undefined): { name: string; department: string | null; city: string | null } | null {
  if (!isCardPayment(label)) return null;
  const name = merchantKey(label);
  if (name.length < 3) return null;
  let s = normalize(label ?? "")
    .replace(/^\d{6}\s+cb\s*\*+\s*\d{2,4}\s*/, "")
    .replace(/\s\d{6}\s+cb\s*\*+\s*\d{2,4}.*$/, "")
    .replace(/\s\d+[.,]\d{2}\s?[a-z]{3}\b.*$/, "");
  const dept = /(?:^|[a-z\s])(\d{2}|2a|2b)([a-z][a-z\s'-]{2,})$/.exec(s);
  if (dept) return { name, department: dept[1]!, city: dept[2]!.trim() };
  s = s.replace(/\s+/g, " ");
  const country = /(?:\sfr\s|fr\s)([a-z][a-z\s'-]{2,})$/.exec(s);
  return { name, department: null, city: country ? country[1]!.trim() : null };
}

/** Clé du cache de l'annuaire : commerçant + département (un même nom ailleurs est un autre commerce). */
export const directoryKey = (place: { name: string; department: string | null }) => `${place.name}|${place.department ?? ""}`;

const words = (s: string) => normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOPWORDS.has(w));

/** La ville du libellé (souvent tronquée : « cagnes sur me ») correspond-elle à cette commune ? */
export function sameCity(city: string | null, commune: string | null | undefined): boolean {
  const ours = city ? normalize(city).replace(/[^a-z]/g, "") : "";
  const theirs = commune ? normalize(commune).replace(/[^a-z]/g, "") : "";
  if (ours.length < 3 || !theirs) return false;
  return theirs.startsWith(ours.slice(0, Math.min(ours.length, 8))) || ours.startsWith(theirs.slice(0, 8));
}

/**
 * Qualité d'une correspondance de l'annuaire, de 0 à 90 : nom (ou enseigne) identique, commençant
 * par le nom tronqué de la banque, ou mots en commun ; puis la ville. Sans la ville du libellé
 * parmi celles de l'entreprise, le score reste sous le seuil de vérification (homonymes).
 */
export function directoryMatchScore(
  place: { name: string; city: string | null; department?: string | null },
  candidate: { names: string[]; communes: string[] },
): number {
  const ours = place.name.replace(/\s+/g, " ");
  let nameScore = 0;
  for (const n of candidate.names) {
    const theirs = words(n).join(" ");
    if (!theirs) continue;
    if (theirs === ours) nameScore = Math.max(nameScore, 45);
    else if (theirs.startsWith(ours) || ours.startsWith(theirs)) nameScore = Math.max(nameScore, 35);
    else {
      // mots en commun (noms tronqués, ordre différent)
      const a = new Set(words(ours));
      const common = words(theirs).filter((w) => a.has(w) || [...a].some((x) => x.length >= 4 && w.startsWith(x))).length;
      if (common && common >= Math.min(a.size, 2)) nameScore = Math.max(nameScore, 25);
    }
  }
  if (!nameScore) return 0;
  const cityMatch = candidate.communes.some((c) => sameCity(place.city, c));
  // même département (filtre de la recherche) sans la ville : un peu plus sûr qu'aucun indice de lieu
  return Math.min(90, nameScore + (cityMatch ? 45 : place.department ? 15 : 10));
}

// ---------------------------------------------------------------------------
// Score de confiance
// ---------------------------------------------------------------------------

/** Origine d'une catégorie : saisie ou validée à la main, ou devinée automatiquement */
export type CategorySource = "manual" | "learned" | "memory" | "rule" | "directory" | "fallback" | "legacy" | "rent";

/** En dessous de ce score, une catégorie automatique est à vérifier */
export const REVIEW_BELOW = 70;

export const CONFIDENCE: Record<Exclude<CategorySource, "directory">, number> = {
  manual: 100,
  learned: 95,
  memory: 70,
  rule: 75,
  legacy: 60,
  fallback: 0,
  rent: 100,
};

export const SOURCE_LABELS: Record<CategorySource, string> = {
  manual: "choisie par toi",
  learned: "apprise de tes choix pour ce commerçant",
  memory: "même libellé déjà classé",
  rule: "mot-clé du libellé",
  directory: "annuaire des entreprises",
  fallback: "aucun indice",
  legacy: "ancien classement",
  rent: "règle de loyer",
};

/** Une catégorie automatique est-elle à vérifier ? (une saisie manuelle ne l'est jamais) */
export const needsReview = (source: string | null | undefined, confidence: number | null | undefined) =>
  !!source && source !== "manual" && (confidence ?? 0) < REVIEW_BELOW;
