import type { getServiceSupabase } from "@/lib/supabase/admin";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * Whether a stored object is really there. A row in `listing_photos`, or a
 * receipt path sent by the client, is a promise that an upload happened; the
 * QA tour (2026-10-29) found annonces online with a photo row whose file never
 * arrived, and payments « en vérification » with a receipt nobody could open.
 *
 * A storage hiccup counts as present: the check is there to catch a missing
 * file, not to keep honest sellers offline while storage sneezes.
 */
export async function objectExists(admin: Admin, bucket: string, path: string): Promise<boolean> {
  const cut = path.lastIndexOf("/");
  const folder = cut >= 0 ? path.slice(0, cut) : "";
  const name = cut >= 0 ? path.slice(cut + 1) : path;
  if (!name) return false;
  const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100, search: name });
  if (error) return true;
  return (data ?? []).some((o) => o.name === name);
}

/** The photo paths of an annonce whose file is not in the `properties` bucket. */
export async function missingPhotos(admin: Admin, listingId: string): Promise<string[]> {
  const { data: rows } = await admin.from("listing_photos").select("storage_path").eq("listing_id", listingId);
  const paths = ((rows ?? []) as { storage_path: string | null }[]).map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  const present = await Promise.all(paths.map((p) => objectExists(admin, "properties", p)));
  return paths.filter((_, i) => !present[i]);
}
