/**
 * Resolve a storage path (bucket-relative) to a public URL on the
 * Supabase storage CDN. We don't go through `storage.from(...).getPublicUrl`
 * here so we can construct URLs in server components without a client
 * round-trip; the format is stable.
 */
export function propertyPhotoUrl(
  storagePath: string,
  opts: { bucket?: string; transform?: { width?: number; quality?: number } } = {},
): string {
  // Pass-through for fully-qualified URLs (Unsplash seed data, externally
  // hosted images) and absolute paths into /public. The Supabase prefix
  // logic only kicks in for bucket-relative paths like
  // `<userId>/photo-1234.jpg`, which is what real uploads produce.
  if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
    return storagePath;
  }
  if (storagePath.startsWith("/")) return storagePath;

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return "/placeholder.jpg";
  const bucket = opts.bucket ?? "properties";
  if (opts.transform?.width || opts.transform?.quality) {
    const params = new URLSearchParams();
    if (opts.transform.width) params.set("width", String(opts.transform.width));
    if (opts.transform.quality) params.set("quality", String(opts.transform.quality));
    return `${base}/storage/v1/render/image/public/${bucket}/${storagePath}?${params}`;
  }
  return `${base}/storage/v1/object/public/${bucket}/${storagePath}`;
}
