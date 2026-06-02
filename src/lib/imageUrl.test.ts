import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isStaticSeedPath, propertyPhotoUrl } from "./imageUrl";

describe("isStaticSeedPath", () => {
  it("flags /properties seed images", () => {
    expect(isStaticSeedPath("/properties/seed-1.webp")).toBe(true);
    expect(isStaticSeedPath("user-123/photo.jpg")).toBe(false);
    expect(isStaticSeedPath("https://x.supabase.co/a.jpg")).toBe(false);
  });
});

describe("propertyPhotoUrl", () => {
  const prev = process.env.NEXT_PUBLIC_SUPABASE_URL;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = prev;
  });

  it("passes through fully-qualified URLs unchanged", () => {
    const u = "https://images.unsplash.com/photo-1.jpg";
    expect(propertyPhotoUrl(u)).toBe(u);
  });
  it("passes through absolute /public paths", () => {
    expect(propertyPhotoUrl("/placeholder.jpg")).toBe("/placeholder.jpg");
  });
  it("builds a public object URL for bucket-relative paths", () => {
    expect(propertyPhotoUrl("user-1/p.jpg")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/properties/user-1/p.jpg",
    );
  });
  it("uses the render endpoint with params when a transform is requested", () => {
    const out = propertyPhotoUrl("user-1/p.jpg", { transform: { width: 640, quality: 72 } });
    expect(out).toContain("/storage/v1/render/image/public/properties/user-1/p.jpg?");
    expect(out).toContain("width=640");
    expect(out).toContain("quality=72");
  });
  it("falls back to a placeholder when the base URL is missing", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(propertyPhotoUrl("user-1/p.jpg")).toBe("/placeholder.jpg");
  });
});
