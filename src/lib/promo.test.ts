import { describe, it, expect } from "vitest";
import { activePromo, canBuy, placementOf, promoEnd } from "./promo";

const NOW = new Date("2026-10-26T12:00:00Z");
const none = { promo_home_featured: false, promo_top_listed: false, promo_banner: false, promo_expires_at: null };
const home = { ...none, promo_home_featured: true, promo_expires_at: "2026-11-10T12:00:00Z" };

describe("placements", () => {
  it("maps each promo product to its column, and nothing else", () => {
    expect(placementOf("promo-accueil")).toBe("promo_home_featured");
    expect(placementOf("promo-top-recherche")).toBe("promo_top_listed");
    expect(placementOf("promo-banniere")).toBe("promo_banner");
    expect(placementOf("renouvellement")).toBeNull();
    expect(placementOf(null)).toBeNull();
  });

  it("knows what runs now, and forgets what has ended", () => {
    expect(activePromo(home, NOW)).toEqual({ column: "promo_home_featured", until: "2026-11-10T12:00:00Z" });
    expect(activePromo({ ...home, promo_expires_at: "2026-10-01T00:00:00Z" }, NOW)).toBeNull();
    expect(activePromo(none, NOW)).toBeNull();
  });

  it("sells one placement at a time, and extends the same one from its end", () => {
    expect(canBuy(none, "promo_top_listed", NOW)).toBe(true);
    expect(canBuy(home, "promo_home_featured", NOW)).toBe(true);
    expect(canBuy(home, "promo_top_listed", NOW)).toBe(false);
    expect(promoEnd(home, "promo_home_featured", 30, NOW).toISOString()).toBe("2026-12-10T12:00:00.000Z");
    expect(promoEnd(none, "promo_top_listed", 30, NOW).toISOString()).toBe("2026-11-25T12:00:00.000Z");
  });
});
