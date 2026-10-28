import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import imageLoader, { STATIC_WIDTHS, hasStaticSizes, staticSize } from "./imageLoader";

const SB = "https://abc.supabase.co";

describe("image loader", () => {
  it("sends a stored photo through Supabase's resizer, at the width asked", () => {
    expect(imageLoader({ src: `${SB}/storage/v1/object/public/properties/u1/a.webp`, width: 640, quality: 72 })).toBe(
      `${SB}/storage/v1/render/image/public/properties/u1/a.webp?width=640&quality=72&resize=contain`,
    );
    expect(imageLoader({ src: `${SB}/storage/v1/object/public/shops/logo.png`, width: 3840 })).toBe(
      `${SB}/storage/v1/render/image/public/shops/logo.png?width=2500&quality=75&resize=contain`,
    );
  });

  it("re-sizes an address that was already a resized one", () => {
    const out = imageLoader({ src: `${SB}/storage/v1/render/image/public/properties/a.webp?width=120&quality=70`, width: 384 });
    expect(new URL(out).searchParams.get("width")).toBe("384");
    expect(new URL(out).searchParams.get("quality")).toBe("70");
    // Never the default « cover », which crops a width-only request to a strip.
    expect(new URL(out).searchParams.get("resize")).toBe("contain");
  });

  it("never sends anything to Vercel's optimizer", () => {
    for (const src of [`${SB}/storage/v1/object/public/p/a.webp`, "/properties/x/1.webp", "/logo.webp", "/og.png", "https://example.com/a.jpg"]) {
      for (const width of [120, 384, 828, 1920]) expect(imageLoader({ src, width })).not.toContain("/_next/image");
    }
  });

  it("gives a static photo the narrowest size made at least as wide, the original past the widest", () => {
    expect(staticSize("/properties/x/1.webp", 200)).toBe("/properties/x/1.w384.webp");
    expect(staticSize("/properties/x/1.webp", 640)).toBe("/properties/x/1.w640.webp");
    expect(staticSize("/properties/x/1.webp", 700)).toBe("/properties/x/1.w828.webp");
    expect(staticSize("/properties/x/1.webp", 1080)).toBe("/properties/x/1.webp");
    expect(staticSize("/properties/x/1.webp", 1280)).toBe("/properties/x/1.webp");
    expect(imageLoader({ src: "/auth-hero.webp", width: 384 })).toBe("/auth-hero.w384.webp");
    expect(hasStaticSizes("/properties/x/1.w384.webp")).toBe(false);
  });

  it("serves a logo as it is, with the width next/image needs in the address", () => {
    expect(imageLoader({ src: "/logo.webp", width: 256 })).toBe("/logo.webp?w=256");
  });

  it("every static photo the loader names has its sizes on disk", () => {
    const pub = join(process.cwd(), "public");
    const files: string[] = [];
    (function walk(dir: string) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else files.push("/" + p.slice(pub.length + 1).split("\\").join("/"));
      }
    })(join(pub, "properties"));
    const sources = [...files, "/auth-hero.webp"].filter(hasStaticSizes);
    expect(sources.length).toBeGreaterThan(0);
    for (const src of sources) {
      for (const w of STATIC_WIDTHS) {
        const size = staticSize(src, w);
        expect(existsSync(join(pub, size)), `${size} — run node scripts/static-image-variants.mjs`).toBe(true);
      }
    }
  });
});
