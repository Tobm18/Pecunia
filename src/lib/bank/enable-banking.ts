import "server-only";
import { createSign } from "node:crypto";
import type { BankBalance, BankTransaction } from "@/lib/domain/bank-sync";

/**
 * Client minimal de l'API Enable Banking (accès aux informations de compte, lecture seule).
 * Chaque requête porte un JWT signé (RS256) avec la clé privée de l'application ; la clé et
 * l'identifiant d'application viennent de l'environnement et ne quittent jamais le serveur.
 * Doc : https://enablebanking.com/docs/api/reference/
 */

const API = "https://api.enablebanking.com";

export const BANK_COUNTRY = "FR";
export const bankName = () => process.env.ENABLE_BANKING_ASPSP?.trim() || "Banque Populaire Méditerranée";
export const redirectUrl = () =>
  process.env.ENABLE_BANKING_REDIRECT_URL?.trim() || `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/integrations/bank/callback`;

/** Erreur de l'API, avec son code HTTP (401/403 : consentement expiré ; 429 : limite atteinte). */
export class BankApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const isBankConfigured = () => !!process.env.ENABLE_BANKING_APP_ID && !!process.env.ENABLE_BANKING_PRIVATE_KEY;

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

function signedJwt(): string {
  const appId = process.env.ENABLE_BANKING_APP_ID;
  const rawKey = process.env.ENABLE_BANKING_PRIVATE_KEY;
  if (!appId || !rawKey) throw new BankApiError(500, "Connexion bancaire non configurée (ENABLE_BANKING_APP_ID et ENABLE_BANKING_PRIVATE_KEY).");
  // la clé tient sur une ligne dans les variables d'environnement : les retours à la ligne sont écrits « \n »
  const key = rawKey.replace(/\\n/g, "\n");
  const iat = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key);
  return `${header}.${payload}.${b64url(signature)}`;
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${signedJwt()}`, ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { message?: string; error?: string };
      detail = data.message ?? data.error ?? "";
    } catch {
      // corps absent ou illisible
    }
    throw new BankApiError(response.status, detail || `Erreur ${response.status} de la banque`);
  }
  // DELETE /sessions/{id} répond sans contenu
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export interface BankSessionAccount {
  uid: string;
  account_id?: { iban?: string | null } | null;
  /** Nom du titulaire (pas celui du compte) */
  name?: string | null;
  /** Libellé du compte (posé par la banque ou par le client) */
  details?: string | null;
  /** Produit bancaire (ex. « Livret A ») */
  product?: string | null;
  /** CACC : compte courant, SVGS : épargne… */
  cash_account_type?: string | null;
  currency?: string | null;
}

export interface BankSession {
  session_id: string;
  accounts: BankSessionAccount[];
  access?: { valid_until?: string };
}

/** Durée maximale de consentement acceptée par la banque, en secondes. */
async function maxConsentSeconds(name: string): Promise<number> {
  const { aspsps } = await call<{ aspsps: { name: string; maximum_consent_validity?: number }[] }>(`/aspsps?country=${BANK_COUNTRY}`);
  const found = aspsps.find((a) => a.name === name);
  if (!found) throw new BankApiError(404, `Banque « ${name} » introuvable chez Enable Banking.`);
  return found.maximum_consent_validity ?? 90 * 86_400;
}

/** Démarre l'autorisation : renvoie l'adresse de la banque où l'utilisateur donne son accord. */
export async function startAuthorization(params: { state: string }): Promise<{ url: string; validUntil: Date }> {
  const name = bankName();
  const validUntil = new Date(Date.now() + (await maxConsentSeconds(name)) * 1000 - 60_000);
  const { url } = await call<{ url: string }>("/auth", {
    method: "POST",
    body: {
      access: { valid_until: validUntil.toISOString() },
      aspsp: { name, country: BANK_COUNTRY },
      state: params.state,
      redirect_url: redirectUrl(),
      psu_type: "personal",
    },
  });
  return { url, validUntil };
}

/** Échange le code de retour de la banque contre une session et la liste des comptes autorisés. */
export function createSession(code: string): Promise<BankSession> {
  return call<BankSession>("/sessions", { method: "POST", body: { code } });
}

/** Révoque le consentement côté Enable Banking (à la déconnexion). */
export async function deleteSession(sessionId: string): Promise<void> {
  await call(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

/** Détails du compte tels que la banque les décrit (diagnostic). */
export function getAccountDetails(uid: string): Promise<unknown> {
  return call<unknown>(`/accounts/${encodeURIComponent(uid)}/details`);
}

export async function getBalances(uid: string): Promise<BankBalance[]> {
  const { balances } = await call<{ balances: BankBalance[] }>(`/accounts/${encodeURIComponent(uid)}/balances`);
  return balances ?? [];
}

/**
 * Toutes les écritures comptabilisées (ou en cours, avec `PDNG`) depuis `dateFrom`, pagination
 * suivie. Sans date, Enable Banking cherche la plus longue période que la banque accepte de
 * fournir (stratégie « longest »).
 */
export async function getTransactions(uid: string, dateFrom: string | null, status: "BOOK" | "PDNG" = "BOOK"): Promise<BankTransaction[]> {
  const out: BankTransaction[] = [];
  let continuationKey: string | undefined;
  for (let page = 0; page < 40; page++) {
    const query = new URLSearchParams({ transaction_status: status });
    if (dateFrom) query.set("date_from", dateFrom);
    else query.set("strategy", "longest");
    if (continuationKey) query.set("continuation_key", continuationKey);
    const data = await call<{ transactions: BankTransaction[]; continuation_key?: string | null }>(`/accounts/${encodeURIComponent(uid)}/transactions?${query}`);
    out.push(...(data.transactions ?? []));
    continuationKey = data.continuation_key ?? undefined;
    if (!continuationKey) break;
  }
  return out;
}
