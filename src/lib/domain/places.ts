/** Mémoire des lieux : catégorie et compte repris de la dernière saisie au même endroit. */
import type { PlaceMemoryEntry } from "./types";

const normalize = (s: string) => s.trim().toLocaleLowerCase("fr-FR");

/** Correspondance exacte, insensible à la casse. */
export function findPlace(memory: PlaceMemoryEntry[], text: string): PlaceMemoryEntry | null {
  const key = normalize(text);
  if (!key) return null;
  return memory.find((m) => normalize(m.place) === key) ?? null;
}

/**
 * Suggestions dès la 1re frappe : d'abord les lieux qui commencent par le texte,
 * puis ceux qui le contiennent, les plus récents d'abord. La correspondance exacte est exclue.
 */
export function suggestPlaces(memory: PlaceMemoryEntry[], text: string, limit = 6): PlaceMemoryEntry[] {
  const key = normalize(text);
  if (!key) return [];
  const byRecency = [...memory].sort((a, b) => (a.lastUsed < b.lastUsed ? 1 : -1));
  const starts: PlaceMemoryEntry[] = [];
  const contains: PlaceMemoryEntry[] = [];
  for (const m of byRecency) {
    const place = normalize(m.place);
    if (place === key) continue;
    if (place.startsWith(key)) starts.push(m);
    else if (place.includes(key)) contains.push(m);
  }
  return [...starts, ...contains].slice(0, limit);
}
