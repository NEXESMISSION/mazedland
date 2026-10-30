import { describe, expect, it } from "vitest";
import { abandonedObjects, referencedPath } from "./prune";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-10-30T12:00:00Z");
const ago = (days: number) => new Date(now - days * DAY).toISOString();

describe("abandonedObjects", () => {
  const objects = [
    { path: "u1/annonce-1.webp", createdAt: ago(10) }, // referenced, old: stays
    { path: "u1/annonce-2.webp", createdAt: ago(10) }, // orphan, old: goes
    { path: "u1/annonce-3.webp", createdAt: ago(1) }, // orphan, still in flight: stays
    { path: "u1/annonce-4.webp", createdAt: null }, // orphan, age unknown: stays
    { path: "u1/.emptyFolderPlaceholder", createdAt: ago(40) }, // not an upload
    { path: "ads/banner.webp", createdAt: ago(40) }, // referenced by an ad: stays
  ];
  const referenced = new Set(["u1/annonce-1.webp", "ads/banner.webp"]);

  it("removes only what nothing references and that is older than the delay", () => {
    expect(abandonedObjects(objects, referenced, 2, now)).toEqual(["u1/annonce-2.webp"]);
  });

  it("the delay is the setting: a longer one keeps more, and it is never under a day", () => {
    expect(abandonedObjects(objects, referenced, 14, now)).toEqual([]);
    expect(abandonedObjects(objects, referenced, 0, now)).toEqual(["u1/annonce-2.webp"]);
  });

  it("exactly at the cutoff is still new", () => {
    expect(abandonedObjects([{ path: "x", createdAt: new Date(now - 2 * DAY).toISOString() }], new Set(), 2, now)).toEqual([]);
    expect(abandonedObjects([{ path: "x", createdAt: new Date(now - 2 * DAY - 1000).toISOString() }], new Set(), 2, now)).toEqual(["x"]);
  });

  it("with no references, every old object goes", () => {
    expect(abandonedObjects(objects, new Set(), 2, now)).toEqual(["u1/annonce-1.webp", "u1/annonce-2.webp", "ads/banner.webp"]);
  });
});

describe("referencedPath", () => {
  it("keeps a bucket-relative path as it is", () => {
    expect(referencedPath("properties", "u1/annonce-1.webp")).toBe("u1/annonce-1.webp");
    expect(referencedPath("properties", " /u1/annonce-1.webp ")).toBe("u1/annonce-1.webp");
  });

  it("reads the object behind a public, a render or a signed URL", () => {
    expect(referencedPath("properties", "https://x.supabase.co/storage/v1/object/public/properties/u1/a%20b.webp?x=1")).toBe("u1/a b.webp");
    expect(referencedPath("properties", "https://x.supabase.co/storage/v1/render/image/public/properties/u1/a.webp?width=400")).toBe("u1/a.webp");
    expect(referencedPath("receipts", "https://x.supabase.co/storage/v1/object/sign/receipts/u1/r.pdf?token=t")).toBe("u1/r.pdf");
  });

  it("names nothing for another bucket's URL, an empty value or a non-string", () => {
    expect(referencedPath("properties", "https://x.supabase.co/storage/v1/object/public/receipts/u1/r.pdf")).toBeNull();
    expect(referencedPath("properties", "")).toBeNull();
    expect(referencedPath("properties", null)).toBeNull();
    expect(referencedPath("properties", 42)).toBeNull();
  });
});
