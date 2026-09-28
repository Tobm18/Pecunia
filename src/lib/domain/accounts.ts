import type { Account } from "./types";

/** Nom court d'un compte pour les puces (« Compte courant » → « Courant »). */
export function shortAccountName(account: Account): string {
  const stripped = account.name.replace(/^(compte|épargne)\s+/i, "").trim();
  if (!stripped) return account.name;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}
