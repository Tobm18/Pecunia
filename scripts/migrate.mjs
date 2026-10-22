// Applique, dans l'ordre, les fichiers SQL de db/migrations/ pas encore exécutés.
// Usage : npm run db:migrate (lit DATABASE_URL_UNPOOLED, sinon DATABASE_URL).
// Base Neon : connexion par WebSocket (port 443), utile quand le port 5432 est bloqué.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (voir .env.example).");
  process.exit(1);
}

/** Client minimal : query(texte) et transaction(fn), quel que soit le driver. */
async function connect() {
  if (new URL(url).hostname.endsWith(".neon.tech")) {
    const { Pool } = await import("@neondatabase/serverless");
    const pool = new Pool({ connectionString: url });
    const client = await pool.connect();
    return {
      query: async (text, params) => (await client.query(text, params)).rows,
      transaction: async (fn) => {
        await client.query("begin");
        try {
          await fn((text, params) => client.query(text, params));
          await client.query("commit");
        } catch (error) {
          await client.query("rollback");
          throw error;
        }
      },
      end: async () => {
        client.release();
        await pool.end();
      },
    };
  }
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  return {
    query: (text, params) => sql.unsafe(text, params),
    transaction: (fn) => sql.begin((tx) => fn((text, params) => tx.unsafe(text, params))),
    end: () => sql.end(),
  };
}

const dir = path.join(import.meta.dirname, "..", "db", "migrations");
const db = await connect();

try {
  await db.query("create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())");
  const applied = new Set((await db.query("select name from _migrations")).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = await readFile(path.join(dir, file), "utf8");
    await db.transaction(async (run) => {
      await run(content);
      await run("insert into _migrations (name) values ($1)", [file]);
    });
    console.log(`appliquée : ${file}`);
  }
  console.log("Base à jour.");
} finally {
  await db.end();
}
