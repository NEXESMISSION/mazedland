import { describe, it, expect } from "vitest";
import {
  closedNotice, generatePost, hashtag, readTracking, referenceCode, shortUrl, socialListingFrom, trackedUrl,
  type SocialListing,
} from "./content";
import { channelFromUtmSource, requestStatusFrom } from "./channels";

const ORIGIN = "https://mazed.example";
const TODAY = "2026-10-24";

const house: SocialListing = socialListingFrom({
  id: "11111111-2222-3333-4444-555555555555",
  deal_type: "sale",
  price: 350000,
  price_on_request: false,
  governorate: "Sfax",
  delegation: "Route de Gremda",
  attributes: { area_sqm: 180, rooms: 3, titled: true },
  category: { slug: "maisons", label_fr: "Maisons", label_ar: "منازل" },
});

const flat: SocialListing = socialListingFrom({
  id: "99999999-8888-7777-6666-555555555555",
  deal_type: "rent",
  price: 1200,
  price_on_request: false,
  governorate: "Sousse",
  delegation: null,
  attributes: { area_sqm: 110, rooms: 2 },
  furnished: "furnished",
  available_from: "2026-12-01",
  category: { slug: "appartements", label_fr: "Appartements", label_ar: "شقق" },
});

describe("generatePost", () => {
  it("writes a French page post from the annonce's own fields", () => {
    const p = generatePost({ listing: house, channel: "facebook_page", language: "fr", origin: ORIGIN, ref: "1A2B3C", today: TODAY });
    const lines = p.body.replace(/ /g, " ").split("\n");
    expect(lines[0]).toBe("🏠 À VENDRE · Maison S+3 · 180 m² · Route de Gremda, Sfax");
    expect(lines[1]).toBe("💰 350 000 DT");
    expect(lines[2]).toBe("✔️ Titre foncier");
    expect(p.body).toContain(`👉 Photos et détails : ${p.linkUrl}`);
    expect(p.body).toContain("Réf. MZ-1A2B3C");
    expect(p.hashtags).toEqual(["#MazedImmo", "#Sfax", "#AVendre"]);
    expect(p.linkUrl).toBe(
      `${ORIGIN}/fr/annonces/${house.id}?utm_source=facebook&utm_medium=social&utm_campaign=mz-1a2b3c`,
    );
  });

  it("says a rent is per month, furnished and when it is free", () => {
    const p = generatePost({ listing: flat, channel: "facebook_page", language: "ar", origin: ORIGIN, ref: "ABCDEF", today: TODAY });
    const lines = p.body.replace(/ /g, " ").replace(/[⁦⁩]/g, "").split("\n");
    // Latin inside an Arabic line is isolated, so the line keeps its order.
    expect(p.body).toContain("⁦S+2⁩");
    expect(lines[0]).toBe("🔑 للكراء · شقة S+2 · 110 م² · سوسة");
    expect(lines[1]).toBe("💰 1 200 د.ت في الشهر");
    expect(lines[2]).toBe("✔️ مفروش، متوفّر من 01/12/2026");
    expect(p.linkUrl).toContain("/ar/annonces/");
    expect(p.body).toContain("المرجع: MZ-ABCDEF");
  });

  it("says « libre immédiatement » once the date has passed", () => {
    const p = generatePost({ listing: { ...flat, availableFrom: "2026-10-01" }, channel: "facebook_page", language: "fr", origin: ORIGIN, ref: "ABCDEF", today: TODAY });
    expect(p.body).toContain("Meublé · Libre immédiatement");
  });

  it("puts Arabic first, then French, when both are asked", () => {
    const p = generatePost({ listing: house, channel: "facebook_page", language: "both", origin: ORIGIN, ref: "1A2B3C", today: TODAY });
    const ar = p.body.indexOf("للبيع");
    const fr = p.body.indexOf("À VENDRE");
    expect(ar).toBeGreaterThanOrEqual(0);
    expect(fr).toBeGreaterThan(ar);
    expect(p.body).toContain("Réf. MZ-1A2B3C");
    expect(p.body).toContain("👉 Photos et détails · التصاور والتفاصيل : ");
    expect(p.hashtags).toContain("#صفاقس");
    expect(p.hashtags).toContain("#Sfax");
  });

  it("gives Instagram the short link, since a caption cannot carry one", () => {
    const p = generatePost({ listing: house, channel: "instagram", language: "fr", origin: ORIGIN, ref: "1a2b3c", today: TODAY });
    expect(p.body).toContain("🔗 Photos et détails : mazed.example/p/1A2B3C (lien dans la bio)");
    expect(p.body).not.toContain("utm_");
    expect(p.hashtags).toContain("#Maison");
    expect(p.hashtags).toContain("#Tunisie");
    expect(p.hashtags.length).toBeLessThanOrEqual(12);
  });

  it("writes plain text for the groups: no emoji, no hashtag", () => {
    const p = generatePost({ listing: house, channel: "facebook_groups", language: "fr", origin: ORIGIN, ref: "1A2B3C", today: TODAY });
    expect(p.body).not.toMatch(/[🏠🔑💰✔️👉#]/u);
    expect(p.hashtags).toEqual([]);
    expect(p.body.split("\n")[0]).toBe("À VENDRE · Maison S+3 · 180 m² · Route de Gremda, Sfax");
    expect(p.linkUrl).toContain("utm_source=facebook_group");
  });

  it("never says a legal fact the seller did not tick", () => {
    const p = generatePost({ listing: { ...house, titled: false }, channel: "facebook_page", language: "fr", origin: ORIGIN, ref: "1A2B3C", today: TODAY });
    expect(p.body).not.toContain("Titre foncier");
    expect(p.body).not.toContain("✔️");
  });

  it("keeps a phone number typed in the place out of the post", () => {
    const p = generatePost({
      listing: { ...house, delegation: "Sakiet Ezzit 22 123 456" },
      channel: "facebook_page", language: "fr", origin: ORIGIN, ref: "1A2B3C", today: TODAY,
    });
    expect(p.body).not.toMatch(/22\s?123\s?456/);
  });

  it("says « prix sur demande » when there is no price", () => {
    const p = generatePost({ listing: { ...house, price: null, priceOnRequest: true }, channel: "facebook_page", language: "fr", origin: ORIGIN, ref: "1A2B3C", today: TODAY });
    expect(p.body).toContain("💰 Prix sur demande");
  });

  it("leaves out what the annonce does not say", () => {
    const land = socialListingFrom({
      id: house.id, deal_type: "sale", price: 90000, price_on_request: false, governorate: "Kairouan", delegation: null,
      attributes: {}, category: { slug: "terrain", label_fr: "Terrains", label_ar: "أراضي" },
    });
    const p = generatePost({ listing: land, channel: "facebook_page", language: "fr", origin: ORIGIN, ref: "1A2B3C", today: TODAY });
    expect(p.body.split("\n")[0]).toBe("🏠 À VENDRE · Terrain · Kairouan");
  });
});

describe("links and references", () => {
  it("tells one group from another", () => {
    const url = trackedUrl(ORIGIN, house.id, { ref: "1A2B3C", channel: "facebook_groups", language: "fr", group: "g-42" });
    expect(new URL(url).searchParams.get("utm_content")).toBe("g-42");
  });

  it("reads back what it wrote", () => {
    const url = new URL(trackedUrl(ORIGIN, house.id, { ref: "1A2B3C", channel: "instagram", language: "both" }));
    const got = readTracking(Object.fromEntries(url.searchParams));
    expect(got).toEqual({ ref: "1A2B3C", source: "instagram" });
    expect(channelFromUtmSource(got?.source)).toBe("instagram");
    expect(readTracking({ utm_medium: "cpc", utm_campaign: "mz-1a2b3c" })).toBeNull();
    expect(readTracking({ utm_medium: "social", utm_campaign: "summer" })).toBeNull();
  });

  it("formats the reference and the short link", () => {
    expect(referenceCode("1a2b3c")).toBe("MZ-1A2B3C");
    expect(shortUrl("https://mazed.example/", "1a2b3c")).toBe("mazed.example/p/1A2B3C");
  });

  it("makes hashtags a network accepts", () => {
    expect(hashtag("Ben Arous")).toBe("#BenArous");
    expect(hashtag("Médenine")).toBe("#Medenine");
    expect(hashtag("سيدي بوزيد")).toBe("#سيدي_بوزيد");
    expect(hashtag("Local commercial")).toBe("#LocalCommercial");
  });

  it("words the sold notice for the deal", () => {
    expect(closedNotice("rent", "fr")).toContain("LOUÉ");
    expect(closedNotice("sale", "both")).toContain("تباع");
    expect(closedNotice("sale", "both")).toContain("VENDU");
  });
});

describe("requestStatusFrom", () => {
  const job = (status: Parameters<typeof requestStatusFrom>[0][number]["status"]) => ({ status, action: "publish" as const });

  it("is online as soon as one channel is", () => {
    expect(requestStatusFrom([job("published"), job("failed")], "scheduled")).toBe("published");
  });
  it("is still on its way while a channel waits for a person", () => {
    expect(requestStatusFrom([job("manual_action_required"), job("failed")], "scheduled")).toBe("scheduled");
  });
  it("fails only when every channel failed", () => {
    expect(requestStatusFrom([job("failed"), job("failed")], "scheduled")).toBe("failed");
  });
  it("ignores cancelled jobs and follow-ups", () => {
    expect(requestStatusFrom([job("cancelled")], "pending_approval")).toBe("pending_approval");
    expect(requestStatusFrom([{ status: "failed", action: "mark_closed" }, job("published")], "published")).toBe("published");
  });
});
