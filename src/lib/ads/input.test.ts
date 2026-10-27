import { describe, it, expect } from "vitest";
import { parseAdInput } from "./input";

const IMG = "ads/3f2a1c0b-1d2e-4f5a-8b9c-0d1e2f3a4b5c.webp";
const IMG2 = "ads/9a8b7c6d-1d2e-4f5a-8b9c-0d1e2f3a4b5c.jpg";

const full = {
  advertiser: "  Banque X  ",
  title: "Crédit habitat",
  title_ar: "",
  image_path: IMG,
  image_mobile_path: IMG2,
  link_url: "www.banque.tn/credit",
  placement: "catalogue",
  starts_on: "2026-10-27",
  ends_on: "2026-11-26",
  active: true,
  sort_order: 3,
};

describe("parseAdInput — a new campaign", () => {
  it("cleans what the form sends", () => {
    const r = parseAdInput(full, { partial: false });
    expect(r).toEqual({
      ok: true,
      value: {
        advertiser: "Banque X",
        title: "Crédit habitat",
        title_ar: null,
        image_path: IMG,
        image_mobile_path: IMG2,
        link_url: "https://www.banque.tn/credit",
        placement: "catalogue",
        starts_at: "2026-10-26T23:00:00.000Z",
        ends_at: "2026-11-26T23:00:00.000Z",
        active: true,
        sort_order: 3,
      },
    });
  });

  it("names the field that is wrong", () => {
    const bad = (patch: Record<string, unknown>) => {
      const r = parseAdInput({ ...full, ...patch }, { partial: false });
      return r.ok ? null : r.error;
    };
    expect(bad({ advertiser: " " })).toBe("advertiser");
    expect(bad({ advertiser: "x".repeat(121) })).toBe("advertiser");
    expect(bad({ title: "x".repeat(161) })).toBe("title");
    expect(bad({ image_path: "someone/annonce.webp" })).toBe("image");
    expect(bad({ image_path: undefined })).toBe("image");
    expect(bad({ image_mobile_path: "https://evil.example/x.png" })).toBe("imageMobile");
    expect(bad({ link_url: "javascript:alert(1)" })).toBe("link");
    expect(bad({ placement: "sidebar" })).toBe("placement");
    expect(bad({ ends_on: "2026-10-26" })).toBe("dates");
  });

  it("fills what is left out", () => {
    const r = parseAdInput(
      { advertiser: "Notaire", image_path: IMG, link_url: "https://notaire.tn", placement: "listing" },
      { partial: false },
    );
    expect(r.ok && r.value).toMatchObject({
      title: null,
      title_ar: null,
      image_mobile_path: null,
      starts_at: null,
      ends_at: null,
      active: true,
      sort_order: 0,
    });
  });

  it("clamps the order", () => {
    const r = parseAdInput({ ...full, sort_order: -4 }, { partial: false });
    expect(r.ok && r.value.sort_order).toBe(0);
    const r2 = parseAdInput({ ...full, sort_order: 1e9 }, { partial: false });
    expect(r2.ok && r2.value.sort_order).toBe(9999);
  });
});

describe("parseAdInput — a change", () => {
  it("touches only what is sent: pausing is the switch alone", () => {
    expect(parseAdInput({ active: false }, { partial: true })).toEqual({ ok: true, value: { active: false } });
  });

  it("removes the phone image when it is sent empty", () => {
    expect(parseAdInput({ image_mobile_path: null }, { partial: true })).toEqual({
      ok: true,
      value: { image_mobile_path: null },
    });
  });

  it("moves the two dates together", () => {
    expect(parseAdInput({ ends_on: "2026-12-31" }, { partial: true })).toEqual({
      ok: true,
      value: { starts_at: null, ends_at: "2026-12-31T23:00:00.000Z" },
    });
  });

  it("still checks what it touches", () => {
    const r = parseAdInput({ link_url: "ftp://x.tn" }, { partial: true });
    expect(r).toEqual({ ok: false, error: "link" });
  });
});
