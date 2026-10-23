import "server-only";
import { directoryMatchScore, sameCity } from "@/lib/domain/categorize";

/**
 * Annuaire des entreprises (API publique Recherche d'entreprises, base SIRENE de l'Insee) : gratuite,
 * sans clé. Sert à trouver l'activité (code NAF) d'un commerçant vu sur un paiement carte.
 * Doc : https://recherche-entreprises.api.gouv.fr/docs/
 */

const API = "https://recherche-entreprises.api.gouv.fr/search";

export interface DirectoryResult {
  name: string | null;
  commune: string | null;
  naf: string | null;
  /** Qualité de la correspondance, 0 (rien de fiable) à 90 */
  score: number;
}

interface ApiEstablishment {
  libelle_commune?: string | null;
  liste_enseignes?: string[] | null;
  activite_principale?: string | null;
  etat_administratif?: string | null;
}

interface ApiCompany {
  nom_complet?: string | null;
  nom_raison_sociale?: string | null;
  sigle?: string | null;
  activite_principale?: string | null;
  siege?: ApiEstablishment | null;
  matching_etablissements?: ApiEstablishment[] | null;
}

/** Meilleure correspondance pour un commerçant ; score 0 si rien de fiable. Lève une erreur si l'API ne répond pas. */
export async function lookupMerchant(place: { name: string; department: string | null; city: string | null }): Promise<DirectoryResult> {
  const query = new URLSearchParams({ q: place.name, per_page: "5", page: "1" });
  if (place.department) query.set("departement", place.department);
  const response = await fetch(`${API}?${query}`, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (response.status === 429) throw new Error("limite de l'annuaire atteinte");
  if (!response.ok) throw new Error(`annuaire : erreur ${response.status}`);
  const { results } = (await response.json()) as { results?: ApiCompany[] };

  let best: DirectoryResult = { name: null, commune: null, naf: null, score: 0 };
  for (const company of results ?? []) {
    const establishments = [...(company.matching_etablissements ?? []), ...(company.siege ? [company.siege] : [])].filter(
      (e) => e.etat_administratif !== "F",
    );
    const names = [company.nom_complet, company.nom_raison_sociale, company.sigle, ...establishments.flatMap((e) => e.liste_enseignes ?? [])].filter(
      (n): n is string => !!n,
    );
    const communes = establishments.map((e) => e.libelle_commune).filter((c): c is string => !!c);
    const score = directoryMatchScore(place, { names, communes });
    if (score <= best.score) continue;
    // activité de l'établissement de la ville du libellé (une holding a souvent un autre code), sinon le premier
    const local =
      establishments.find((e) => e.activite_principale && sameCity(place.city, e.libelle_commune)) ??
      establishments.find((e) => e.activite_principale) ??
      null;
    best = { name: company.nom_complet ?? null, commune: local?.libelle_commune ?? communes[0] ?? null, naf: local?.activite_principale ?? company.activite_principale ?? null, score };
  }
  return best;
}
