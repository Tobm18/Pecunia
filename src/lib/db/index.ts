import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Connexion PostgreSQL (Neon, ou tout autre Postgres) via DATABASE_URL.
 * prepare: false : compatible avec les pools en mode transaction (PgBouncer, pooler Neon).
 * En développement, le client est gardé entre deux rechargements à chaud.
 */
const globalForDb = globalThis as unknown as { pecuniaSql?: ReturnType<typeof postgres> };

const client =
  globalForDb.pecuniaSql ??
  postgres(process.env.DATABASE_URL!, { prepare: false, max: process.env.NODE_ENV === "production" ? 5 : 10 });
if (process.env.NODE_ENV !== "production") globalForDb.pecuniaSql = client;

export const db = drizzle(client, { schema });
export type Db = typeof db;
export { schema };
