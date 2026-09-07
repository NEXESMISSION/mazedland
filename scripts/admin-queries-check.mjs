// ============================================================================
// Run every admin screen's real query shape against the live database.
//
//   node scripts/admin-queries-check.mjs
//
// WHY THIS EXISTS. A React Server Component streams its shell before its data
// layer runs, so a page whose query is broken still answers HTTP 200 with a
// complete-looking layout. Loading the page proves nothing. Three separate bugs
// shipped through that gap:
//
//   1. `listing_photos.is_cover` did not exist on this project. Every query in
//      the ported moderation queue failed; the pages rendered 200 and empty.
//   2. `seller_badges` points at `profiles` twice (`seller_id`, `granted_by`),
//      so a bare `seller_badges(...)` embed is ambiguous and PostgREST refuses
//      the whole request. `/admin/vendeurs` listed nobody, on both projects,
//      silently, for as long as the screen existed.
//   3. The payments badge counted `deposit_lock` rows the queue cannot settle,
//      so the rail showed work that could never be cleared.
//
// None of those are type errors, so `tsc` is blind to them. None are lint
// errors. All three are one HTTP round trip away from being obvious.
//
// The rule for adding a case: copy the `.select()` string from the page
// VERBATIM. A paraphrase tests a query nobody runs. If the page changes its
// select, this file changes with it — that coupling is the point.
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const now = new Date().toISOString();
const dayAgo = new Date(Date.now() - 48 * 3_600_000).toISOString();

/** The kinds `/admin/paiements` can settle. Mirrors admin/layout.tsx. */
const CONSOLE_PAYMENT_KINDS = [
  "listing_fee", "listing_pack", "subscription", "promo", "badge", "renewal",
];

let pass = 0;
const failures = [];

/**
 * `run` takes a THUNK, not a promise: a PostgREST builder is thenable, so
 * building it eagerly would fire the request before we are ready to name it.
 */
async function check(screen, what, thunk) {
  let res;
  try {
    res = await thunk();
  } catch (e) {
    res = { error: { message: String(e?.message ?? e) } };
  }
  const label = `${screen} — ${what}`;
  if (res?.error) {
    failures.push({ label, message: res.error.message });
    console.log(`FAIL  ${label}\n      ${res.error.message}`);
  } else {
    pass += 1;
    const n = res?.count ?? (Array.isArray(res?.data) ? res.data.length : res?.data ? 1 : 0);
    console.log(`ok    ${label}  (${n})`);
  }
}

// ── /admin (dashboard) ──────────────────────────────────────────────────────
const head = (t) => sb.from(t).select("*", { count: "exact", head: true });

await check("dashboard", "listings pending", () => head("listings").eq("status", "pending_review"));
await check("dashboard", "listings overdue", () =>
  head("listings").eq("status", "pending_review").lt("created_at", dayAgo));
await check("dashboard", "published today", () =>
  head("listings").eq("status", "published").gte("published_at", dayAgo));
await check("dashboard", "console payments pending", () =>
  head("payments").in("kind", CONSOLE_PAYMENT_KINDS).eq("status", "pending_review"));
await check("dashboard", "expiring within 7 days", () =>
  head("listings").eq("status", "published").not("expires_at", "is", null)
    .gte("expires_at", now).lte("expires_at", now));
await check("dashboard", "expired", () => head("listings").eq("status", "expired"));
await check("dashboard", "recent gestures", () =>
  sb.from("activity_log").select("id, created_at, action, user_email")
    .not("action", "is", null).not("action", "like", "client.%")
    .not("action", "like", "server.%").order("created_at", { ascending: false }).limit(10));

// ── /admin/annonces ─────────────────────────────────────────────────────────
await check("annonces", "queue list", () =>
  sb.from("listings").select(
    `id, title, price, price_on_request, status, governorate, created_at,
     published_at, expires_at, seller_id,
     seller:profiles!listings_seller_id_fkey (full_name, phone),
     category:categories!listings_category_id_fkey (label_fr),
     photos:listing_photos (storage_path, is_cover, sort_order)`,
    { count: "exact" },
  ).order("created_at", { ascending: false }).range(0, 29));
await check("annonces", "tab tally", () =>
  sb.from("listings").select("status, expires_at"));

// ── /admin/paiements ────────────────────────────────────────────────────────
await check("paiements", "queue list", () =>
  sb.from("payments").select(
    `id, kind, status, amount, provider, created_at, receipt_uploaded_at,
     receipt_url, receipt_urls, admin_notes, metadata, user_id,
     payer:profiles!payments_user_id_fkey (full_name, phone)`,
    { count: "exact" },
  ).in("kind", CONSOLE_PAYMENT_KINDS).order("created_at", { ascending: false }).range(0, 29));
await check("paiements", "revenue tally", () =>
  sb.from("payments").select("status, amount, created_at").in("kind", CONSOLE_PAYMENT_KINDS));
await check("paiements", "search columns", () =>
  sb.from("payments").select("id").or("provider_ref.ilike.%x%,admin_notes.ilike.%x%").limit(1));

// ── /admin/vendeurs ─────────────────────────────────────────────────────────
// The embed hint is the whole test. Drop `!seller_badges_seller_id_fkey` and
// this fails — which is exactly how it shipped.
await check("vendeurs", "account list", () =>
  sb.from("profiles").select(
    "id, full_name, phone, role, governorate, created_at, banned_at, seller_badges!seller_badges_seller_id_fkey(expires_at, revoked_at)",
    { count: "exact" },
  ).is("deleted_at", null).order("created_at", { ascending: false }).range(0, 29));
await check("vendeurs", "verified tab (inner join)", () =>
  sb.from("profiles").select(
    "id, full_name, phone, role, governorate, created_at, banned_at, seller_badges!seller_badges_seller_id_fkey!inner(expires_at, revoked_at)",
    { count: "exact" },
  ).is("deleted_at", null).is("seller_badges.revoked_at", null)
    .gt("seller_badges.expires_at", now).range(0, 29));
await check("vendeurs", "detail columns", () =>
  sb.from("profiles")
    .select("id, full_name, phone, role, governorate, created_at, banned_at, banned_reason")
    .limit(1));
await check("vendeurs", "active credits", () =>
  sb.from("seller_credits").select("quota_total, quota_used, expires_at")
    .eq("status", "active").gt("expires_at", now));
await check("vendeurs", "grantable packs", () =>
  sb.from("products").select("id, name_fr, listing_quota")
    .eq("kind", "listing_pack").eq("is_active", true).order("sort_order"));

// ── /admin/offres ───────────────────────────────────────────────────────────
await check("offres", "product list", () =>
  sb.from("products").select(
    "id, slug, kind, name_fr, name_ar, description, price, category_id, listing_quota, duration_days, is_active, sort_order",
  ).order("sort_order"));

// ── /admin/catalogue ────────────────────────────────────────────────────────
await check("catalogue", "categories tree", () =>
  sb.from("categories").select("id, parent_id, slug, label_fr, kind, sort_order, is_active")
    .order("sort_order"));
await check("catalogue", "category attributes", () =>
  sb.from("category_attributes").select(
    "id, category_id, field_key, label, data_type, options, unit, required, filterable, sort_order",
  ).order("sort_order"));
await check("catalogue", "attribute usage source", () =>
  sb.from("listings").select("category_id, attributes"));

// ── /annonces and /annonces/[id] (public) ─────────────────────────────
// Not an admin screen, but the same failure mode and the same blindness: the
// detail page is a Server Component, so a broken select renders a 200 with an
// empty shell.
await check("annonce detail", "listing + category + photos", () =>
  sb.from("listings").select(`
    id, title, description, price, price_on_request, negotiable,
    governorate, delegation, attributes, contact_name, show_phone, status,
    published_at, expires_at, seller_id, reference,
    category:categories (id, label_fr, kind),
    photos:listing_photos (storage_path, sort_order)
  `).eq("status", "published").limit(1));
await check("annonce detail", "category attributes for specs", () =>
  sb.from("category_attributes").select("field_key, label, unit, options, sort_order")
    .order("sort_order").limit(1));
await check("annonce detail", "has_verified_badge rpc", async () => {
  const { error } = await sb.rpc("has_verified_badge", {
    p_seller: "00000000-0000-0000-0000-000000000000",
  });
  return error ? { error } : { data: true };
});
await check("annonce detail", "favourite lookup", () =>
  sb.from("watchlist").select("id").not("listing_id", "is", null).limit(1));
await check("annonce detail", "reveal log", () =>
  sb.from("contact_reveals").select("listing_id, user_id, ip_hash").limit(1));
await check("annonce detail", "view analytics", () =>
  sb.from("listing_analytics").select("*").limit(1));

// ── Storage buckets the detail panes sign URLs from ─────────────────────────
await check("storage", "buckets", async () => {
  const { data, error } = await sb.storage.listBuckets();
  if (error) return { error };
  for (const need of ["receipts", "properties"]) {
    if (!data.some((b) => b.name === need)) {
      return { error: { message: `bucket "${need}" is missing` } };
    }
  }
  return { data };
});

console.log(`\n${pass} ok, ${failures.length} failed`);
if (failures.length) {
  console.log("\nEvery failure above is a screen that renders 200 and shows nothing.");
  process.exit(1);
}
