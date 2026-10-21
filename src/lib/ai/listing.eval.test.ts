/**
 * Live evaluation of the listing assistant — 30 sentences the way Tunisian
 * sellers write them (Derja in Arabic and Latin script, MSA, French), against
 * what a person reads in them.
 *
 * It calls the real model and costs money (about 0.05 USD a run), so it only
 * runs when asked:
 *
 *   AI_EVAL=1 npx pnpm vitest run src/lib/ai/listing.eval.test.ts
 *
 * with ANTHROPIC_API_KEY in .env.local. Each call is logged in `ai_calls` like
 * any other, so the run shows in the AI spend. The bar is the cahier des
 * charges' acceptance criterion for task 1.10: deal, category, governorate,
 * surface and price right in at least 90 % of the fields asked.
 */
import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { callJson } from "./server";
import { buildSystemPrompt, LISTING_DRAFT_SCHEMA, normalizeListingDraft, type DraftCategory, type ListingDraft } from "./listing";
import { redactContacts } from "@/lib/moderation/rules";

config({ path: ".env.local", quiet: true });

type Expect = Partial<Pick<ListingDraft, "deal" | "categorySlug" | "governorate" | "price" | "areaSqm" | "rooms" | "furnished">>;

const CASES: [string, Expect][] = [
  ["عندي دار في صفاقس، طريق قرمدة، 180 متر، نحب نبيعها بـ350 مليون", { deal: "sale", categorySlug: "maisons", governorate: "Sfax", price: 350_000, areaSqm: 180 }],
  ["نبيع شقة S+2 في سوسة، 110 متر، الطابق الثاني، 220 ألف دينار", { deal: "sale", categorySlug: "appartements", governorate: "Sousse", price: 220_000, areaSqm: 110, rooms: 2 }],
  ["شقة S+2 في سكرة للكراء بـ1200 دينار في الشهر، مفروشة", { deal: "rent", categorySlug: "appartements", governorate: "Ariana", price: 1200, rooms: 2, furnished: "furnished" }],
  ["Villa à vendre à Hammamet, 300 m², 4 chambres, 850 000 DT", { deal: "sale", categorySlug: "villas", governorate: "Nabeul", price: 850_000, areaSqm: 300 }],
  ["Terrain de 500 m² à Sfax route de Tunis km 8, prix 120 mille dinars", { deal: "sale", categorySlug: "terrain", governorate: "Sfax", price: 120_000, areaSqm: 500 }],
  ["نكري حانوت في المنستير، 40 متر، 900 دينار في الشهر", { deal: "rent", categorySlug: "locaux-commerciaux", governorate: "Monastir", price: 900, areaSqm: 40 }],
  ["Appartement S+1 à louer à Tunis centre, 65 m², 750 DT/mois, vide", { deal: "rent", categorySlug: "appartements", governorate: "Tunis", price: 750, areaSqm: 65, rooms: 1, furnished: "unfurnished" }],
  ["عندي أرض فلاحية في القيروان، 2 هكتار، بـ90 مليون", { deal: "sale", governorate: "Kairouan", price: 90_000, areaSqm: 20_000 }],
  ["Bureau à louer aux Berges du Lac 2 à Tunis, 120 m², 2500 DT par mois", { deal: "rent", categorySlug: "bureaux", governorate: "Tunis", price: 2500, areaSqm: 120 }],
  ["نبيع فيلا في نابل، 400 متر، S+5، بـ1 مليار و200 مليون", { deal: "sale", categorySlug: "villas", governorate: "Nabeul", price: 1_200_000, areaSqm: 400, rooms: 5 }],
  ["Dépôt à vendre à Ben Arous, 1000 m², 1,5 million de dinars", { deal: "sale", categorySlug: "depots", governorate: "Ben Arous", price: 1_500_000, areaSqm: 1000 }],
  ["شقة للكراء في المنار، S+3، 1800 دينار، فارغة", { deal: "rent", categorySlug: "appartements", governorate: "Tunis", price: 1800, rooms: 3 }],
  ["Maison à vendre à Djerba Houmt Souk, 250 m², 380 000 DT", { deal: "sale", categorySlug: "maisons", governorate: "Médenine", price: 380_000, areaSqm: 250 }],
  ["نكري ستوديو في المرسى بـ700 دينار مفروش", { deal: "rent", categorySlug: "appartements", governorate: "Tunis", price: 700, furnished: "furnished" }],
  ["Lot de terrain 300 m² à Bizerte, constructible, 75 000 DT", { deal: "sale", categorySlug: "terrain", governorate: "Bizerte", price: 75_000, areaSqm: 300 }],
  ["نبيع مقسم في قابس 400 متر بـ60 ألف", { deal: "sale", categorySlug: "terrain", governorate: "Gabès", price: 60_000, areaSqm: 400 }],
  ["Local commercial à louer à Sfax centre-ville, 80 m², 1500 DT", { deal: "rent", categorySlug: "locaux-commerciaux", governorate: "Sfax", price: 1500, areaSqm: 80 }],
  ["دار عربي في المدينة العتيقة بتونس للبيع، 150 متر، 280 مليون", { deal: "sale", categorySlug: "maisons", governorate: "Tunis", price: 280_000, areaSqm: 150 }],
  ["Appartement haut standing S+3 à Ennasr, 160 m², 520 000 DT", { deal: "sale", categorySlug: "appartements", governorate: "Ariana", price: 520_000, areaSqm: 160, rooms: 3 }],
  ["نكري دار في القصرين S+2 بـ450 دينار", { deal: "rent", categorySlug: "maisons", governorate: "Kasserine", price: 450, rooms: 2 }],
  ["Ferme de 10 hectares à Siliana avec puits, 400 000 DT", { deal: "sale", categorySlug: "fermes", governorate: "Siliana", price: 400_000, areaSqm: 100_000 }],
  ["شقة S+1 في نابل للبيع بـ150 مليون، 75 متر", { deal: "sale", categorySlug: "appartements", governorate: "Nabeul", price: 150_000, areaSqm: 75, rooms: 1 }],
  ["A louer bureau 50 m² à Sousse Khezama, 900 DT par mois", { deal: "rent", categorySlug: "bureaux", governorate: "Sousse", price: 900, areaSqm: 50 }],
  ["نبيع حانوت في بنزرت 30 متر بـ90 ألف دينار", { deal: "sale", categorySlug: "locaux-commerciaux", governorate: "Bizerte", price: 90_000, areaSqm: 30 }],
  ["Villa S+4 avec piscine à louer à Hammamet, 3500 DT/mois, meublée", { deal: "rent", categorySlug: "villas", governorate: "Nabeul", price: 3500, rooms: 4, furnished: "furnished" }],
  ["عندي أرض في المهدية 1000 متر، فيها رسم عقاري، بـ200 مليون", { deal: "sale", categorySlug: "terrain", governorate: "Mahdia", price: 200_000, areaSqm: 1000 }],
  ["Appartement S+2 à vendre à Monastir, 95 m², prix 210 mille dinars", { deal: "sale", categorySlug: "appartements", governorate: "Monastir", price: 210_000, areaSqm: 95, rooms: 2 }],
  ["nbi3 dar fi sfax 200 metre b 400 melyoun", { deal: "sale", categorySlug: "maisons", governorate: "Sfax", price: 400_000, areaSqm: 200 }],
  ["nekri appartement S+1 fi sousse b 650 dinar fel che7ar", { deal: "rent", categorySlug: "appartements", governorate: "Sousse", price: 650, rooms: 1 }],
  ["Dépôt 600 m² à louer, zone industrielle de Sfax, 3000 DT par mois", { deal: "rent", categorySlug: "depots", governorate: "Sfax", price: 3000, areaSqm: 600 }],
];

const run = process.env.AI_EVAL === "1" && Boolean(process.env.ANTHROPIC_API_KEY);

describe.runIf(run)("listing assistant — live evaluation", () => {
  it("reads at least 90 % of the asked fields right", async () => {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const { data: catRows } = await admin.from("categories").select("slug, label_fr, kind, parent_id").eq("is_active", true);
    const categories: DraftCategory[] = (catRows ?? [])
      .filter((c) => c.parent_id != null)
      .map((c) => ({ slug: c.slug as string, label: c.label_fr as string, kind: c.kind as string }));
    const system = buildSystemPrompt(categories);

    let asked = 0;
    let right = 0;
    const misses: string[] = [];
    for (const [sentence, expected] of CASES) {
      const out = await callJson({
        admin: admin as never,
        userId: null,
        feature: "listing_draft_eval",
        system,
        user: redactContacts(sentence),
        schema: LISTING_DRAFT_SCHEMA as unknown as Record<string, unknown>,
      });
      const draft = out.ok ? normalizeListingDraft(out.data, { categories, sourceText: sentence }) : null;
      for (const [field, want] of Object.entries(expected)) {
        asked += 1;
        const got = draft ? (draft as Record<string, unknown>)[field] : undefined;
        if (got === want) right += 1;
        else misses.push(`${sentence}\n    ${field}: expected ${String(want)}, got ${String(got)}`);
      }
    }
    const score = right / asked;
    console.log(`listing assistant: ${right}/${asked} fields right (${Math.round(score * 100)} %)`);
    if (misses.length) console.log(misses.join("\n"));
    expect(score).toBeGreaterThanOrEqual(0.9);
  }, 600_000);
});
