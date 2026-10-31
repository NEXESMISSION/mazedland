// qa-lib.cjs — shared helpers for the QA tour of Mazed Immo.
//
// The database is the LIVE production database. Everything a test creates is
// tagged [TEST], tracked, and removed by cleanup(). Never touch real rows.
//
// Where things are — the main checkout, the code under test, the QA server, the
// work folder — comes from config.cjs (scripts/qa/config.json and the QA_*
// variables), never from a path typed here. Agent scripts live in the work
// folder, so they require this file by its absolute path (args.lib in the
// workflow prompts):
//
//   const qa = require("<main checkout>/scripts/qa/qa-lib.cjs");
//   const u = await qa.makeUser({ label: "seller" });           // signed-in [TEST] account (cookie)
//   const a = await qa.makeUser({ label: "boss", role: "admin" }); // full admin; { role: "admin", scopes: ["annonces"] } for a scoped one
//   const r = await qa.call(u, "POST", "/api/annonces", { ... });  // { status, json, text, headers, location }
//   const r2 = await qa.get(null, "/fr/annonces");                 // anonymous page fetch
//   const photo = await qa.uploadPhoto(u);                         // storage path in bucket `properties`
//   const id = await qa.makeListing(u, { title: "[TEST] …" });     // draft through the API (tracked)
//   qa.P(cond, "what this checks", extraOnFailure);                // tally a check
//   ... finally { await qa.cleanup(); console.log(qa.report()); }
//
// Rules the helpers enforce or expect:
//   - names/titles start with "[TEST]"; phones are +2161… (no real Tunisian line starts with 1);
//   - sms_notifications_enabled=false on every test profile; never call /api/auth/phone/send with
//     a real-looking number, never call /api/cron/* with the real key (they send SMS/e-mail to real people);
//   - at most a handful of AI calls per agent (the site has a $2/day budget);
//   - the rate limiter is per IP and every agent shares localhost: a 429 on an auth route under
//     load is not a bug. Space auth calls out, and do not loop on them.
const path = require("path");
const fs = require("fs");

const cfg = require("./config.cjs");

const ROOT = cfg.root;     // the main checkout: has node_modules + .env.local
const REPO = cfg.code;     // the code under test: the checkout the QA server was built from
const BASE = cfg.baseUrl;  // the QA server (QA_BASE still overrides it, through config.cjs)
const WORK = cfg.work;     // where the agents' scripts, logs and findings go
const req = (m) => require(path.join(ROOT, "node_modules", m));
req("dotenv").config({ path: path.join(ROOT, ".env.local"), quiet: true });
const { createClient } = req("@supabase/supabase-js");
const pg = req("pg");

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const COOKIE = `sb-${new URL(URL_).hostname.split(".")[0]}-auth-token`;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`;
const made = { users: [], listings: [], photos: [], shops: [], payments: [], requests: [], visits: [], extra: [] };
let counter = 0;

async function db(fn) {
  for (const port of [5432, 6543]) {
    const c = new pg.Client({ host: process.env.SB_HOST, port, user: `postgres.${process.env.SB_REF}`, password: process.env.SB_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
    try { await c.connect(); } catch { continue; }
    try { return await fn(c); } finally { await c.end(); }
  }
  throw new Error("no db connection");
}

function cookieHeader(session) {
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  if (value.length <= 3180) return `${COOKIE}=${value}`;
  return Array.from({ length: Math.ceil(value.length / 3180) }, (_, i) => `${COOKIE}.${i}=${value.slice(i * 3180, (i + 1) * 3180)}`).join("; ");
}

/** A signed-in [TEST] account. role: "individual" (default) | "admin". scopes: for a scoped admin (0178). */
async function makeUser({ label = "user", role = "individual", scopes = null, language = "fr", governorate = "Tunis" } = {}) {
  counter++;
  const stamp = Date.now();
  const email = `qa-${label}-${RUN}-${counter}@example.com`;
  const password = `Qa!${stamp}x${counter}`;
  const phone = `+2161${String((stamp * 7919 + process.pid * 31 + counter) % 10_000_000).padStart(7, "0")}`;
  const fullName = `[TEST] ${label} ${RUN}`;
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, phone, governorate, language } });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  const id = data.user.id;
  made.users.push(id);
  await db(async (c) => {
    await c.query("begin");
    await c.query("select set_config('app.bypass_profile_guard','on',true)");
    await c.query(
      "update public.profiles set full_name=$2, phone=$3, sms_notifications_enabled=false, role=$4, admin_scopes=$5, language=$6 where id=$1",
      [id, fullName, phone, role, scopes, language],
    );
    await c.query("commit");
  });
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn(${label}): ${e2.message}`);
  return { id, email, password, phone, fullName, role, cookie: cookieHeader(s.session), session: s.session };
}

/** An HTTP call to the server as `who` (or anonymous with null). Same-origin headers set. */
async function call(who, method, p, body, opts = {}) {
  const locale = opts.locale || "fr";
  const headers = {
    origin: BASE,
    referer: `${BASE}/${locale}/`,
    "accept-language": locale,
    ...(who ? { cookie: who.cookie } : {}),
    ...(body !== undefined && !(body instanceof FormData) ? { "content-type": "application/json" } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(BASE + p, {
    method,
    redirect: "manual",
    headers,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs || 60_000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: Object.fromEntries(res.headers.entries()), location: res.headers.get("location") };
}
const get = (who, p, opts) => call(who, "GET", p, undefined, opts);

/** Upload one small JPEG through the site's own signed-URL route; returns the storage path (tracked). */
async function uploadPhoto(who, { width = 1200, height = 800, color = "#8a9bb0" } = {}) {
  const sharp = req("sharp");
  const r = await call(who, "POST", "/api/annonces/photo-url", { exts: ["jpg"] });
  const up = r.json?.uploads?.[0];
  if (!up?.signedUrl) throw new Error(`photo-url: ${r.status} ${r.text.slice(0, 200)}`);
  const img = await sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
  const fd = new FormData();
  fd.append("cacheControl", "3600");
  fd.append("", new Blob([img], { type: "image/jpeg" }));
  const put = await fetch(up.signedUrl, { method: "PUT", body: fd, headers: { "x-upsert": "false" } });
  if (!put.ok) throw new Error(`upload: ${put.status}`);
  made.photos.push(up.path);
  return up.path;
}

let leafCategory = null;
/** A leaf category id (Appartements when it exists), for test annonces. */
async function categoryId(slug = "appartements") {
  if (leafCategory) return leafCategory;
  const { data } = await svc.from("categories").select("id, slug, parent_id").eq("is_active", true);
  const hit = (data ?? []).find((c) => c.slug === slug && c.parent_id) ?? (data ?? []).find((c) => c.parent_id);
  leafCategory = hit.id;
  return leafCategory;
}

/** A draft annonce through POST /api/annonces (tracked). Pass `photo` to reuse an uploaded path. */
async function makeListing(who, over = {}) {
  const photo = over.photo || (await uploadPhoto(who));
  const body = {
    category_id: await categoryId(),
    title: `[TEST] Appartement S+2 ${RUN}-${++counter}`,
    description: "[TEST] annonce de vérification, supprimée à la fin.",
    price: 250000, price_on_request: false, negotiable: false, deal_type: "sale",
    governorate: "Tunis", delegation: "La Marsa",
    attributes: { area_sqm: 110, rooms: 2, floor: 2 },
    photos: [{ storage_path: photo, sort_order: 0 }],
    contact_name: who.fullName, contact_phone: who.phone, contact_whatsapp: who.phone, show_phone: true,
    attestation_version: "v2",
    ...over,
  };
  delete body.photo;
  const r = await call(who, "POST", "/api/annonces", body);
  if (r.status !== 200 || !r.json?.id) throw new Error(`POST /api/annonces: ${r.status} ${r.text.slice(0, 300)}`);
  made.listings.push(r.json.id);
  return r.json.id;
}

/** Remember a row created some other way, so cleanup removes it: track("shops", id) / track("payments", id) / track("extra", {table, id}). */
function track(kind, idOrRow) {
  (made[kind] ??= []).push(idOrRow);
}

let passed = 0, failed = 0;
const lines = [];
function P(ok, msg, extra) {
  ok ? passed++ : failed++;
  const line = `${ok ? "✓" : "✗"} ${msg}${extra !== undefined && !ok ? "  → " + JSON.stringify(extra).slice(0, 400) : ""}`;
  lines.push(line);
  console.log(line);
  return ok;
}
function report() {
  return { passed, failed, lines };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Remove everything this process created. Best effort, in dependency order; says what was left. */
async function cleanup() {
  const log = (what, error) => { if (error) console.log(`  cleanup ${what}: ${error.message || error}`); };
  const users = made.users, listings = made.listings;
  // Anything else tracked under a table name.
  for (const row of made.extra) {
    const { error } = await svc.from(row.table).delete().eq(row.column || "id", row.id);
    log(row.table, error);
  }
  if (listings.length) {
    for (const t of ["listing_photos", "listing_views", "contact_reveals", "listing_reports", "watchlist", "visit_requests", "matches", "leads", "social_publication_requests"]) {
      const { error } = await svc.from(t).delete().in("listing_id", listings);
      if (error && !/does not exist|column/.test(error.message)) log(t, error);
    }
    for (const id of listings) await svc.from("notifications").delete().like("link", `%${id}%`);
  }
  for (const id of made.visits) { const { error } = await svc.from("visit_requests").delete().eq("id", id); log("visit_requests", error); }
  for (const id of made.requests) {
    await svc.from("matches").delete().eq("request_id", id);
    const { error } = await svc.from("property_requests").delete().eq("id", id); log("property_requests", error);
  }
  if (users.length) {
    for (const t of ["visit_requests", "property_requests", "watchlist", "listing_reports", "contact_reveals", "user_consents", "ai_calls", "popup_views", "social_tracking_events"]) {
      const col = t === "listing_reports" ? "reporter_id" : t === "visit_requests" ? "buyer_id" : "user_id";
      const { error } = await svc.from(t).delete().eq(col, users[0]).in(col, users);
      if (error && !/does not exist|column/.test(error.message)) {
        const r2 = await svc.from(t).delete().in("user_id", users);
        if (r2.error && !/does not exist|column/.test(r2.error.message)) log(t, r2.error);
      }
    }
  }
  for (const id of made.shops) {
    for (const t of ["shop_subscriptions", "shop_members", "shop_documents", "leads", "project_units"]) {
      const { error } = await svc.from(t).delete().eq("shop_id", id);
      if (error && !/does not exist|column/.test(error.message)) log(t, error);
    }
    await svc.from("projects").delete().eq("shop_id", id);
    await svc.from("notifications").delete().like("link", `%${id}%`);
    const { error } = await svc.from("shops").delete().eq("id", id); log("shops", error);
  }
  if (users.length) {
    const { data: pays } = await svc.from("payments").select("id").in("user_id", users);
    const payIds = [...new Set([...(pays ?? []).map((p) => p.id), ...made.payments])];
    if (payIds.length) {
      await svc.from("invoices").delete().in("payment_id", payIds);
      const { error } = await svc.from("payments").delete().in("id", payIds); log("payments", error);
    }
    await svc.from("shop_subscriptions").delete().in("user_id", users).then(() => {}, () => {});
    await svc.from("shop_members").delete().in("user_id", users).then(() => {}, () => {});
    const { data: owned } = await svc.from("shops").select("id").in("owner_id", users);
    for (const s of owned ?? []) {
      for (const t of ["shop_subscriptions", "shop_members", "shop_documents", "leads"]) await svc.from(t).delete().eq("shop_id", s.id);
      await svc.from("shops").delete().eq("id", s.id);
    }
    const { data: mine } = await svc.from("listings").select("id").in("seller_id", users);
    const all = [...new Set([...listings, ...(mine ?? []).map((l) => l.id)])];
    if (all.length) {
      await svc.from("listing_photos").delete().in("listing_id", all);
      const { error } = await svc.from("listings").delete().in("id", all); log("listings", error);
    }
  } else if (listings.length) {
    const { error } = await svc.from("listings").delete().in("id", listings); log("listings", error);
  }
  if (made.photos.length) { const { error } = await svc.storage.from("properties").remove(made.photos); log("storage", error); }
  if (users.length) {
    await db(async (c) => {
      await c.query("begin");
      await c.query("select set_config('app.audit_cleanup','on',true)");
      await c.query("delete from public.admin_audit where actor_id = any($1::uuid[]) or target_id = any($2::text[])", [users, users]);
      await c.query("commit");
    }).catch((e) => log("admin_audit", e));
    await svc.from("activity_log").delete().in("user_id", users);
    await svc.from("notifications").delete().in("user_id", users);
    for (const id of users) { const { error } = await svc.auth.admin.deleteUser(id); log("auth user", error); }
    const { count } = await svc.from("profiles").select("id", { count: "exact", head: true }).in("id", users);
    const { count: l } = await svc.from("listings").select("id", { count: "exact", head: true }).in("seller_id", users);
    console.log(`  cleanup: ${users.length} test accounts removed · left behind: ${count ?? "?"} profiles, ${l ?? "?"} listings`);
  }
  // Reset so a second cleanup() is harmless.
  for (const k of Object.keys(made)) made[k] = [];
}

/** Server-side errors the prod server printed since `since` (ms epoch), from the QA server log. */
function serverLog(since = 0) {
  try {
    const f = process.env.QA_SERVER_LOG;
    if (!f || !fs.existsSync(f)) return "";
    const s = fs.statSync(f);
    return s.mtimeMs >= since ? fs.readFileSync(f, "utf8").slice(-20000) : "";
  } catch { return ""; }
}

module.exports = { ROOT, REPO, BASE, WORK, RUN, svc, db, makeUser, call, get, uploadPhoto, makeListing, categoryId, track, P, report, cleanup, sleep, serverLog, cookieHeader, made };
