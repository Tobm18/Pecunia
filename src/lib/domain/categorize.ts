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
const STOPWORDS = new Set(["sas", "sarl", "sa", "eurl", "sc", "sci", "snc", "the", "le", "la", "les", "de", "du", "des", "et", "e", "fr", "eu"]);

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
  // virement à une personne : le motif répété (« Virement de M Tom Ballester ») n'est pas le nom
  s = s.replace(/\s(virement|vir\.?)\s(de|vers)\b.*$/, "");
  let prefix = "";
  if (/^prlv\s+sepa\s+/.test(s)) {
    prefix = "prlv ";
    s = s.replace(/^prlv\s+sepa\s+/, "");
  } else if (/^vir(\s+inst)?\s+/.test(s)) {
    s = s.replace(/^vir(\s+inst)?\s+/, "");
    if (/^(envoi\s+)?wero\s+/.test(s)) {
      prefix = "wero ";
      s = s.replace(/^(envoi\s+)?wero\s+/, "");
    } else prefix = "vir ";
  }
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
