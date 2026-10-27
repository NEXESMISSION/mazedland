import { describe, it, expect } from "vitest";
import fr from "../../../messages/fr.json";
import ar from "../../../messages/ar.json";
import {
  AD_PLACEMENTS, AD_STATUSES, adAlt, adImageExt, adStatus, chartCeil, ctr, formatCtr,
  isAdImagePath, isLive, safeAdLink,
} from "./ads";

const NOW = new Date("2026-10-27T10:00:00Z");
const on = (starts_at: string | null, ends_at: string | null, active = true) => ({ active, starts_at, ends_at });

describe("isLive", () => {
  it("shows a switched-on campaign without dates", () => {
    expect(isLive(on(null, null), NOW)).toBe(true);
  });

  it("shows it from its first instant to just before its last", () => {
    expect(isLive(on("2026-10-27T10:00:00Z", null), NOW)).toBe(true);
    expect(isLive(on(null, "2026-10-27T10:00:01Z"), NOW)).toBe(true);
    expect(isLive(on("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"), NOW)).toBe(true);
  });

  it("does not show it before it starts, once it ends, or paused", () => {
    expect(isLive(on("2026-10-27T10:00:01Z", null), NOW)).toBe(false);
    // `ends_at` is the first moment it no longer shows.
    expect(isLive(on(null, "2026-10-27T10:00:00Z"), NOW)).toBe(false);
    expect(isLive(on(null, null, false), NOW)).toBe(false);
  });
});

describe("adStatus", () => {
  it("names each state", () => {
    expect(adStatus(on(null, null), NOW)).toBe("live");
    expect(adStatus(on("2026-11-01T00:00:00Z", null), NOW)).toBe("scheduled");
    expect(adStatus(on(null, "2026-10-01T00:00:00Z"), NOW)).toBe("ended");
    expect(adStatus(on(null, null, false), NOW)).toBe("paused");
  });

  it("says ended over paused, and paused over scheduled", () => {
    expect(adStatus(on(null, "2026-10-01T00:00:00Z", false), NOW)).toBe("ended");
    expect(adStatus(on("2026-11-01T00:00:00Z", null, false), NOW)).toBe("paused");
  });

  it("agrees with isLive", () => {
    for (const ad of [on(null, null), on(null, null, false), on("2026-11-01T00:00:00Z", null), on(null, "2026-10-01T00:00:00Z")]) {
      expect(isLive(ad, NOW)).toBe(adStatus(ad, NOW) === "live");
    }
  });
});

describe("status and placement labels", () => {
  const labels = (m: unknown) => (m as { adminAds: { status: Record<string, string>; tabs: Record<string, string>; placements: Record<string, string>; placementHints: Record<string, string> } }).adminAds;

  it("exist in French and in Arabic for every state", () => {
    for (const m of [fr, ar]) {
      for (const s of AD_STATUSES) {
        expect(labels(m).status[s]?.trim()).toBeTruthy();
        expect(labels(m).tabs[s]?.trim()).toBeTruthy();
      }
    }
    expect(labels(fr).status).toMatchObject({ live: "En cours", scheduled: "Programmée", ended: "Terminée", paused: "En pause" });
  });

  it("exist in French and in Arabic for every placement", () => {
    for (const m of [fr, ar]) {
      for (const p of AD_PLACEMENTS) {
        expect(labels(m).placements[p]?.trim()).toBeTruthy();
        expect(labels(m).placementHints[p]?.trim()).toBeTruthy();
      }
    }
  });

  it("say on every banner that it is an ad", () => {
    expect((fr as { ads: { label: string } }).ads.label).toBe("Publicité");
    expect((ar as { ads: { label: string } }).ads.label).toBe("إشهار");
  });
});

describe("safeAdLink", () => {
  it("keeps http and https addresses", () => {
    expect(safeAdLink("https://www.biat.com.tn/credit")).toBe("https://www.biat.com.tn/credit");
    expect(safeAdLink("http://notaire.tn")).toBe("http://notaire.tn/");
    expect(safeAdLink("  https://promo.tn/offre?utm_source=mazed  ")).toBe("https://promo.tn/offre?utm_source=mazed");
  });

  it("takes an address typed without its scheme as https", () => {
    expect(safeAdLink("www.banque.tn/credit")).toBe("https://www.banque.tn/credit");
    expect(safeAdLink("banque.tn")).toBe("https://banque.tn/");
  });

  it("refuses every other scheme", () => {
    expect(safeAdLink("javascript:alert(1)")).toBeNull();
    expect(safeAdLink("JavaScript:alert(1)")).toBeNull();
    expect(safeAdLink("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeAdLink("mailto:contact@banque.tn")).toBeNull();
    expect(safeAdLink("tel:+21671000000")).toBeNull();
    expect(safeAdLink("ftp://banque.tn")).toBeNull();
  });

  it("refuses an address that hides where it goes, or is not one", () => {
    expect(safeAdLink("https://mazed.tn@evil.example")).toBeNull();
    expect(safeAdLink("https://user:pass@banque.tn")).toBeNull();
    expect(safeAdLink("banque")).toBeNull();
    expect(safeAdLink("https://banque .tn")).toBeNull();
    expect(safeAdLink("")).toBeNull();
    expect(safeAdLink(null)).toBeNull();
    expect(safeAdLink(42)).toBeNull();
    expect(safeAdLink(`https://banque.tn/${"a".repeat(600)}`)).toBeNull();
  });
});

describe("ctr", () => {
  it("is clicks over views", () => {
    expect(ctr(5, 200)).toBe(0.025);
    expect(ctr(0, 200)).toBe(0);
  });

  it("is unknown before anyone has seen the banner", () => {
    expect(ctr(0, 0)).toBeNull();
    expect(ctr(3, 0)).toBeNull();
  });

  it("never passes 100 %", () => {
    expect(ctr(12, 10)).toBe(1);
  });
});

describe("formatCtr", () => {
  it("prints a percentage in the reader's language", () => {
    expect(formatCtr(0.025, "fr")).toBe("2,5 %");
    expect(formatCtr(0.0034, "fr")).toBe("0,34 %");
    expect(formatCtr(0, "fr")).toBe("0 %");
    expect(formatCtr(0.025, "ar")).toContain("2");
  });

  it("prints a dash for an unknown rate", () => {
    expect(formatCtr(null, "fr")).toBe("—");
  });
});

describe("chartCeil", () => {
  it("rounds the top of the scale up to a clean number", () => {
    expect(chartCeil(0)).toBe(5);
    expect(chartCeil(3)).toBe(5);
    expect(chartCeil(7)).toBe(10);
    expect(chartCeil(13)).toBe(20);
    expect(chartCeil(48)).toBe(50);
    expect(chartCeil(100)).toBe(100);
    expect(chartCeil(101)).toBe(200);
    expect(chartCeil(2600)).toBe(5000);
  });
});

describe("images", () => {
  it("are stored as jpg, png or webp", () => {
    expect(adImageExt("image/jpeg")).toBe("jpg");
    expect(adImageExt("bannière.JPEG")).toBe("jpg");
    expect(adImageExt("image/png")).toBe("png");
    expect(adImageExt("webp")).toBe("webp");
    expect(adImageExt("image/gif")).toBeNull();
    expect(adImageExt("photo.heic")).toBeNull();
  });

  it("only live under ads/<uuid>", () => {
    expect(isAdImagePath("ads/3f2a1c0b-1d2e-4f5a-8b9c-0d1e2f3a4b5c.webp")).toBe(true);
    expect(isAdImagePath("ads/../3f2a1c0b-1d2e-4f5a-8b9c-0d1e2f3a4b5c.webp")).toBe(false);
    expect(isAdImagePath("user-id/annonce-1.webp")).toBe(false);
    expect(isAdImagePath("ads/3f2a1c0b-1d2e-4f5a-8b9c-0d1e2f3a4b5c.svg")).toBe(false);
    expect(isAdImagePath("https://evil.example/ad.png")).toBe(false);
    expect(isAdImagePath(null)).toBe(false);
  });
});

describe("adAlt", () => {
  const ad = { advertiser: "Banque X", title: "Crédit habitat", title_ar: "قرض سكني" };
  it("reads the title in the page's language, then the other, then the advertiser", () => {
    expect(adAlt(ad, "fr")).toBe("Crédit habitat");
    expect(adAlt(ad, "ar")).toBe("قرض سكني");
    expect(adAlt({ ...ad, title_ar: null }, "ar")).toBe("Crédit habitat");
    expect(adAlt({ ...ad, title: " ", title_ar: null }, "fr")).toBe("Banque X");
  });
});
