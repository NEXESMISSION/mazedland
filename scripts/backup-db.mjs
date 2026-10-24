/**
 * A copy of the live data before a migration (cahier global V1, §01 and
 * §12-20: « aucun changement en production sans sauvegarde »).
 *
 * Every table of the `public` schema, row for row, as JSON, into
 * backups/<date>_<time>/<table>.json, with a manifest of the row counts.
 * The schema itself is the migrations folder; this is the data. The `auth`
 * schema (password hashes) is deliberately left out — Supabase keeps it, and
 * it has no business on a laptop.
 *
 * The files hold personal data (names, phone numbers): backups/ is ignored by
 * git, and the folder should stay on this machine.
 *
 *   node scripts/backup-db.mjs
 *
 * Reads only: one READ ONLY transaction, so the copy is consistent.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { SB_HOST, SB_REF, SB_DB_PASSWORD } = process.env;
if (!SB_HOST || !SB_REF || !SB_DB_PASSWORD) {
  console.error("SB_HOST / SB_REF / SB_DB_PASSWORD missing from .env.local");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
const dir = path.join(ROOT, "backups", stamp);
fs.mkdirSync(dir, { recursive: true });

const client = new pg.Client({
  host: SB_HOST,
  port: 5432,
  user: `postgres.${SB_REF}`,
  password: SB_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const manifest = { takenAt: new Date().toISOString(), host: SB_HOST, tables: {} };
try {
  await client.query("begin transaction isolation level repeatable read read only");
  const { rows: tables } = await client.query(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1",
  );
  for (const { table_name: name } of tables) {
    const { rows } = await client.query(`select * from public.${client.escapeIdentifier(name)}`);
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rows));
    manifest.tables[name] = rows.length;
  }
  const { rows: last } = await client.query(
    "select version from supabase_migrations.schema_migrations order by version desc limit 1",
  ).catch(() => ({ rows: [] }));
  manifest.lastMigration = last[0]?.version ?? null;
  await client.query("rollback");
} finally {
  await client.end();
}

fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
const total = Object.values(manifest.tables).reduce((a, b) => a + b, 0);
console.log(`backup: ${Object.keys(manifest.tables).length} tables, ${total} rows → ${path.relative(ROOT, dir)}`);
