/**
 * Which uploads are abandoned — the selection behind /api/cron/prune-uploads.
 *
 * Photos go up to the `properties` bucket while the wizard is still open, and
 * receipts to `receipts` before the payment is sent: an upload is a promise
 * that a row will follow. Most of the public photo bucket and of the receipts
 * bucket was objects no row ever named (the QA tour, 2026-10-30): wizards
 * closed after the photos went up, payments never sent, rows deleted since.
 * They only grew, and every photo among them was publicly downloadable.
 *
 * Pure, so the rule is tested without a bucket: the route lists the objects
 * and the rows, this decides.
 */

export type StoredObject = {
  /** The object's key in its bucket, « <userId>/annonce-…webp ». */
  path: string;
  /** When it was written; unknown counts as new, never as old. */
  createdAt: string | null;
};

/** Storage marks an empty folder with this file; it is not an upload. */
const PLACEHOLDER = ".emptyFolderPlaceholder";

/**
 * A row's reference as the bucket knows it. Rows hold the bucket-relative
 * path, but a value written by hand or by an older client may carry the
 * public URL or a leading slash; a reference misread is a file deleted, so
 * every spelling of the same object counts.
 */
export function referencedPath(bucket: string, value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.trim();
  if (!v) return null;
  const marker = `/${bucket}/`;
  if (/^https?:\/\//i.test(v)) {
    const at = v.indexOf(`/storage/v1/`);
    const rest = at >= 0 ? v.slice(at) : v;
    const cut = rest.indexOf(marker);
    if (cut < 0) return null;
    v = rest.slice(cut + marker.length).split("?")[0];
    try {
      v = decodeURIComponent(v);
    } catch {
      // Left as written: a malformed escape still names the object it was stored as.
    }
  }
  v = v.replace(/^\/+/, "");
  return v || null;
}

/**
 * The objects nothing references and that are older than `days` — the only
 * ones removed. The delay keeps an upload still in flight (photos picked, the
 * annonce not yet sent; a receipt whose payment is being filled in) out of
 * the sweep.
 */
export function abandonedObjects(
  objects: readonly StoredObject[],
  referenced: ReadonlySet<string>,
  days: number,
  now: number = Date.now(),
): string[] {
  const cutoff = now - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const out: string[] = [];
  for (const o of objects) {
    if (!o.path || o.path.endsWith(PLACEHOLDER)) continue;
    if (referenced.has(o.path)) continue;
    const written = o.createdAt ? Date.parse(o.createdAt) : NaN;
    if (!Number.isFinite(written) || written >= cutoff) continue;
    out.push(o.path);
  }
  return out;
}
