import { NextRequest, NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { requireAdmin } from "@/lib/admin/guard";
import { audit } from "@/lib/admin/audit";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

// Reading every table takes a few seconds; leave room as the data grows.
export const maxDuration = 60;

const BUCKET = "backups";
/** How many files stay in the bucket; older ones are removed after each new one. */
const KEEP = 10;
/** How long the download link works. */
const LINK_SECONDS = 600;

/**
 * POST /api/admin/backup — « Sauvegarde » in /admin/settings.
 *
 * A full admin only (the settings section is never handed out piecemeal):
 * the file holds every person's name and phone number. Every table of the
 * `public` schema, read through 0189's two service-role functions, goes into
 * one gzipped JSON file — { takenAt, by, tables: { name: rows }, data: { name:
 * [...] } } — written to the private `backups` bucket and handed back as a
 * link valid ten minutes. The `auth` schema stays out, as in
 * scripts/backup-db.mjs. Tables are read one after the other, not in one
 * snapshot: a row written meanwhile may be in one table and not another.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "settings");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data: names, error: listErr } = await admin.rpc("admin_backup_tables");
  if (listErr || !Array.isArray(names)) return fail("backup_list_failed", 500, listErr);

  const takenAt = new Date();
  const counts: Record<string, number> = {};
  const data: Record<string, unknown[]> = {};
  for (const raw of names as unknown[]) {
    const name = String(raw);
    const { data: rows, error } = await admin.rpc("admin_backup_table", { p_table: name });
    if (error) return fail("backup_read_failed", 500, error);
    const list = Array.isArray(rows) ? rows : [];
    data[name] = list;
    counts[name] = list.length;
  }

  const body = gzipSync(JSON.stringify({ takenAt: takenAt.toISOString(), by: user.id, tables: counts, data }));
  const file = `mazed-immo-${takenAt.toISOString().replace(/[:T]/g, "-").slice(0, 19)}.json.gz`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(file, body, {
    contentType: "application/gzip",
    upsert: false,
  });
  if (upErr) return fail("backup_upload_failed", 500, upErr);

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(file, LINK_SECONDS, { download: file });
  if (signErr || !signed?.signedUrl) return fail("backup_link_failed", 500, signErr);

  // Keep the last few: names start with the date, so they sort by age.
  const { data: kept } = await admin.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  const old = (kept ?? []).map((o) => o.name).filter((n) => n.endsWith(".json.gz")).slice(KEEP);
  if (old.length) await admin.storage.from(BUCKET).remove(old);

  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  logAction(req, user, "admin.backup", { file, tables: Object.keys(counts).length, rows, bytes: body.length });
  await audit(admin, user.id, {
    action: "admin.backup",
    targetType: "backup",
    targetId: file,
    after: { tables: Object.keys(counts).length, rows, bytes: body.length },
  });

  return NextResponse.json({
    ok: true,
    url: signed.signedUrl,
    file,
    tables: Object.keys(counts).length,
    rows,
    bytes: body.length,
  });
}
