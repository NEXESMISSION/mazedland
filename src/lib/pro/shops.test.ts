import { describe, it, expect } from "vitest";
import { can, canAssign, parseShopInput, slugify } from "./shops";

const USER = "11111111-2222-3333-4444-555555555555";

describe("rights in a shop", () => {
  it("lets the owner do everything and an agent only publish and follow clients", () => {
    expect(can("owner", "subscribe")).toBe(true);
    expect(can("admin", "manage_members")).toBe(true);
    expect(can("admin", "subscribe")).toBe(false);
    expect(can("admin", "documents")).toBe(false);
    expect(can("agent", "publish")).toBe(true);
    expect(can("agent", "edit_shop")).toBe(false);
    expect(can("agent", "clients")).toBe(true);
    expect(can("agent", "manage_listings")).toBe(false);
    expect(can(null, "publish")).toBe(false);
  });
  it("never makes a second owner, and an admin only adds agents", () => {
    expect(canAssign("owner", "admin")).toBe(true);
    expect(canAssign("owner", "owner")).toBe(false);
    expect(canAssign("admin", "agent")).toBe(true);
    expect(canAssign("admin", "admin")).toBe(false);
    expect(canAssign("agent", "agent")).toBe(false);
  });
});

describe("slugify", () => {
  it("makes an address from a Latin name", () => {
    expect(slugify("Agence Él Médina — Sfax", "abc")).toBe("agence-el-medina-sfax");
  });
  it("falls back for a name with no Latin letters", () => {
    expect(slugify("وكالة المدينة", "A1B2C3D4E5")).toBe("boutique-a1b2c3d4");
  });
});

describe("parseShopInput", () => {
  const base = { name: "Agence El Medina", kind: "agency", governorate: "Sfax" };
  it("accepts a complete form and normalises it", () => {
    const r = parseShopInput({ ...base, phone: "+216 98 123 456", website: "elmedina.tn", logo_path: `${USER}/logo.webp` }, USER);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.phone).toBe("+21698123456");
      expect(r.value.website).toBe("https://elmedina.tn");
      expect(r.value.logo_path).toBe(`${USER}/logo.webp`);
    }
  });
  it("names the field that is wrong", () => {
    expect(parseShopInput({ ...base, name: "x" }, USER)).toEqual({ ok: false, error: "name" });
    expect(parseShopInput({ ...base, kind: "bank" }, USER)).toEqual({ ok: false, error: "kind" });
    expect(parseShopInput({ ...base, governorate: "Paris" }, USER)).toEqual({ ok: false, error: "governorate" });
    expect(parseShopInput({ ...base, phone: "12" }, USER)).toEqual({ ok: false, error: "phone" });
    expect(parseShopInput({ ...base, email: "nope" }, USER)).toEqual({ ok: false, error: "email" });
  });
  it("refuses a logo stored under someone else's folder", () => {
    const r = parseShopInput({ ...base, logo_path: "someone-else/logo.webp" }, USER);
    expect(r.ok && r.value.logo_path).toBeNull();
  });
});
