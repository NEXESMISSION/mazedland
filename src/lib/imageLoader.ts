/**
 * Where next/image fetches each size of a picture (next.config.ts →
 * images.loaderFile), instead of Vercel's optimizer.
 *
 * WHY. The optimizer is billed per source image, and on the free plan its
 * monthly quota ran out (2026-10-27): every picture it had not cached yet
 * answered 402 « OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED ». SafeImage then
 * fell back to the full original — 200–400 kB for a card 180 px wide — and on
 * a phone the catalogue's largest picture took 5.5 s to show (Lighthouse).
 *
 * WHAT INSTEAD.
 *  - A photo in Supabase Storage goes through Supabase's own resizer
 *    (/storage/v1/render/image), already used by the console's thumbnails:
 *    the width the page asks for, WebP for browsers that take it, cached on
 *    Supabase's CDN. Always `resize=contain`: given a width alone, the
 *    default (« cover ») keeps the original HEIGHT and crops — a 1536×1024
 *    photo asked at 384 came back 384×1024, a vertical strip of it.
 *  - The demo annonces' photos in /public/properties, and the sign-in
 *    picture, have sizes made in advance (scripts/static-image-variants.mjs):
 *    the smallest one at least as wide as asked.
 *  - Anything else static (logos) is small and served as it is; the width
 *    rides as a query string next/image needs, which a static file ignores.
 *
 * Runs in the browser and on the server: no imports, nothing but strings.
 */

const OBJECT = "/storage/v1/object/public/";
const RENDER = "/storage/v1/render/image/public/";

/** The sizes made in advance for the static photos, narrowest first. */
export const STATIC_WIDTHS = [384, 640, 828] as const;

/** Static pictures that have their sizes made in advance. */
export function hasStaticSizes(src: string): boolean {
  if (/\.w\d+\.webp$/.test(src)) return false;
  return /^\/properties\/[^?#]+\.webp$/.test(src) || src === "/auth-hero.webp";
}

/** The file made for a width: the narrowest at least that wide, or the original past the widest. */
export function staticSize(src: string, width: number): string {
  const w = STATIC_WIDTHS.find((v) => v >= width);
  return w ? src.replace(/\.webp$/, `.w${w}.webp`) : src;
}

export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  const q = String(quality ?? 75);
  // Supabase's resizer takes up to 2500 px.
  const w = String(Math.min(width, 2500));
  if (/^https?:\/\//.test(src)) {
    const at = src.indexOf(OBJECT);
    if (at >= 0) {
      const [path] = src.slice(at + OBJECT.length).split("?");
      return `${src.slice(0, at)}${RENDER}${path}?width=${w}&quality=${q}&resize=contain`;
    }
    if (src.includes(RENDER)) {
      const u = new URL(src);
      u.searchParams.set("width", w);
      if (!u.searchParams.has("quality")) u.searchParams.set("quality", q);
      if (!u.searchParams.has("height")) u.searchParams.set("resize", "contain");
      return u.toString();
    }
    return src;
  }
  if (hasStaticSizes(src)) return staticSize(src, width);
  return `${src}${src.includes("?") ? "&" : "?"}w=${w}`;
}
