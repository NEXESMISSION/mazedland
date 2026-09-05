// ============================================================================
// Apply named migration files to the database in .env.local, in order.
//
//   node scripts/apply-migrations.mjs 0145 0148          # dry run: prints SQL size
//   node scripts/apply-migrations.mjs --commit 0145 0148
//
// Each file runs inside ONE transaction, so a failure leaves nothing behind.
// Files that are already applied are expected to be idempotent (every
// migration in this repo is written that way: `if not exists`, `create or
// replace`, `drop policy if exists`).
//
// This exists because the project has no migration runner: migrations were
// applied by hand through the Supabase SQL editor, which is how 0145-0148 ended
// up written-but-never-run while the code that needed them shipped.
// ============================================================================
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const DIR = "supabase/migrations";
const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const prefixes = argv.filter((a) => !a.startsWith("--"));

if (prefixes.length === 0) {
  console.error("usage: node scripts/apply-migrations.mjs [--commit] <prefix> [prefix...]");
  process.exit(1);
}

const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const files = prefixes.map((p) => {
  const hit = all.find((f) => f.startsWith(p));
  if (!hit) {
    console.error(`no migration starts with "${p}"`);
    process.exit(1);
  }
  return hit;
});

const client = new pg.Client({
  host: process.env.SB_HOST,
  port: 5432,
  user: `postgres.${process.env.SB_REF}`,
  password: process.env.SB_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
console.log(`target: ${process.env.SB_HOST}\n`);

for (const file of files) {
  const sql = readFileSync(path.join(DIR, file), "utf8");
  const lines = sql.split("\n").length;
  if (!COMMIT) {
    console.log(`DRY  ${file}  (${lines} lines, ${sql.length} bytes)`);
    continue;
  }
  process.stdout.write(`RUN  ${file} … `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("ok");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    console.error(`     ${e.message}`);
    process.exit(1);
  }
}

if (!COMMIT) console.log("\nDry run — nothing applied. Re-run with --commit.");
await client.end();
