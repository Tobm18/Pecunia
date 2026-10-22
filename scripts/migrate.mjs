// Applique, dans l'ordre, les fichiers SQL de db/migrations/ pas encore exécutés.
// Usage : npm run db:migrate (lit DATABASE_URL_UNPOOLED, sinon DATABASE_URL).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL manquant (voir .env.example).");
  process.exit(1);
}

const dir = path.join(import.meta.dirname, "..", "db", "migrations");
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql`select name from _migrations`).map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const content = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`insert into _migrations (name) values (${file})`;
    });
    console.log(`appliquée : ${file}`);
  }
  console.log("Base à jour.");
} finally {
  await sql.end();
}
