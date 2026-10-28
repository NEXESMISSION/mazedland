import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { audit } from "@/lib/admin/audit";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { zipStore, type ZipEntry } from "@/lib/zip";

// Every file comes down from Storage and the ZIP goes back up: on a home
// connection that took a minute. The functions run next to the database
// (vercel.json: dub1), and fluid compute allows up to 300 s on this plan.
export const maxDuration = 300;

const BUCKET = "backups";
/** Files backups are big: only the last few stay in the bucket. */
const KEEP = 3;
const LINK_SECONDS = 600;
/** Past this, a function's memory and time are the wrong tool: the PC script is. */
const MAX_BYTES = 150 * 1024 * 1024;
/** Downloads at the same time. */
const PARALLEL = 8;

type Item = { bucket: string; path: string; size: number; updated: string | null };
type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/** Every file of a bucket, folder by folder (Storage lists one level at a time). */
async function walk(admin: Admin, bucket: string, prefix = ""): Promise<Item[]> {
  const out: Item[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw error;
    for (const e of data ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await walk(admin, bucket, path)));
      else out.push({ bucket, path, size: Number(e.metadata?.size ?? 0), updated: e.updated_at ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * POST /api/admin/backup/files — « Fichiers » in /admin/settings.
 *
 * The other half of the backup: the database backup (/api/admin/backup, and
 * Supabase's own daily one) holds where each photo, receipt and document is,
 * not the files. This puts every file of every bucket — the `backups` bucket
 * itself aside — in one ZIP, `<bucket>/<path>` inside, with a manifest, and
 * hands it back through a 10-minute link. A full admin only, recorded in the
 * audit trail. Past 150 MB it says to use scripts/backup-storage.mjs instead.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req, "settings");
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { data: buckets, error: bErr } = await admin.storage.listBuckets();
  if (bErr) return fail("backup_list_failed", 500, bErr);

  let items: Item[] = [];
  try {
    for (const b of buckets ?? []) if (b.id !== BUCKET) items.push(...(await walk(admin, b.id)));
  } catch (e) {
    return fail("backup_list_failed", 500, e);
  }
  items = items.filter((i) => !i.path.endsWith(".emptyFolderPlaceholder"));

  const total = items.reduce((n, i) => n + i.size, 0);
  if (total > MAX_BYTES) {
    return NextResponse.json(
      { error: "too_big", files: items.length, megabytes: Math.round(total / 1048576) },
      { status: 413 },
    );
  }

  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    const batch = items.slice(i, i + PARALLEL);
    const got = await Promise.all(
      batch.map(async (it) => {
        const { data, error } = await admin.storage.from(it.bucket).download(it.path);
        if (error || !data) return null;
        return { it, bytes: new Uint8Array(await data.arrayBuffer()) };
      }),
    );
    got.forEach((g, k) => {
      if (!g) missing.push(`${batch[k].bucket}/${batch[k].path}`);
      else entries.push({ name: `${g.it.bucket}/${g.it.path}`, data: g.bytes, date: g.it.updated ? new Date(g.it.updated) : undefined });
    });
  }

  const takenAt = new Date();
  const manifest = {
    takenAt: takenAt.toISOString(),
    by: user.id,
    files: entries.length,
    bytes: entries.reduce((n, e) => n + e.data.length, 0),
    buckets: Object.fromEntries(
      [...new Set(items.map((i) => i.bucket))].map((b) => [b, items.filter((i) => i.bucket === b).length]),
    ),
    missing,
  };
  entries.push({ name: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)), date: takenAt });
  const zip = zipStore(entries);
  const file = `files-mazed-immo-${takenAt.toISOString().replace(/[:T]/g, "-").slice(0, 19)}.zip`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(file, zip, { contentType: "application/zip", upsert: false });
  if (upErr) return fail("backup_upload_failed", 500, upErr);
  const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(file, LINK_SECONDS, { download: file });
  if (signErr || !signed?.signedUrl) return fail("backup_link_failed", 500, signErr);

  const { data: kept } = await admin.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  const old = (kept ?? []).map((o) => o.name).filter((n) => n.startsWith("files-") && n.endsWith(".zip")).slice(KEEP);
  if (old.length) await admin.storage.from(BUCKET).remove(old);

  logAction(req, user, "admin.backup_files", { file, files: manifest.files, bytes: zip.length, missing: missing.length });
  await audit(admin, user.id, {
    action: "admin.backup_files",
    targetType: "backup",
    targetId: file,
    after: { files: manifest.files, bytes: zip.length, missing: missing.length },
  });

  return NextResponse.json({ ok: true, url: signed.signedUrl, file, files: manifest.files, bytes: zip.length, missing: missing.length });
}
