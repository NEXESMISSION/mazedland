// Read-only checks of the production site after the deploy. No test data, no writes.
//   node scripts/qa/verify-prod.cjs        (prodUrl in config.json, or QA_PROD_URL)
const BASE = require("./config.cjs").prodUrl;
const checks = [];
const P = (ok, msg) => { checks.push(ok); console.log(`${ok ? "✓" : "✗"} ${msg}`); };
const get = (path, init) => fetch(BASE + path, { redirect: "manual", ...init });
(async () => {
  let r = await get("/fr");
  P(r.status === 200, `GET /fr → ${r.status}`);
  P(!r.headers.get("x-powered-by"), `no X-Powered-By (${r.headers.get("x-powered-by") ?? "absent"})`);
  const buildId = (await r.text()).match(/_next\/static\/([A-Za-z0-9_-]{15,})\/_buildManifest/)?.[1] ?? "?";
  console.log("  build id", buildId);

  r = await get("/fr/page-inconnue-qa-tour");
  P(r.status === 404, `unknown /fr path → ${r.status}`);
  r = await get("/ar/page-inconnue-qa-tour");
  const html = await r.text();
  P(r.status === 404 && /<html[^>]*lang="ar"[^>]*dir="rtl"/.test(html), `unknown /ar path → ${r.status}, Arabic rtl page: ${/lang="ar"/.test(html)}`);
  P(!/Mazed Immo · Mazed Immo/.test(html), "404 title names the brand once");

  r = await get("/fr/admin/annonces");
  P(r.status === 307 && /\/fr\/login/.test(r.headers.get("location") ?? ""), `anonymous console → ${r.status} ${r.headers.get("location")}`);
  r = await get("/fr/%77atchlist");
  P(r.status === 307, `encoded /fr/watchlist gate → ${r.status}`);
  r = await get("/api/cron/notify-sms?key=not-the-secret");
  P(r.status === 403, `cron key in the URL → ${r.status}`);
  r = await get("/api/health");
  P(r.status === 200, `/api/health → ${r.status}`);
  r = await get("/api/popups/event", { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: "null" });
  P(r.status === 400, `POST /api/popups/event null body → ${r.status}`);
  r = await get("/api/annonces/not-a-uuid/favorite", { method: "POST", headers: { origin: BASE } });
  P(r.status === 401, `favorite without a session → ${r.status}`);
  r = await get("/icons/apple-touch-icon-180.png", { method: "HEAD" });
  P(/max-age=86400/.test(r.headers.get("cache-control") ?? ""), `icon cache-control: ${r.headers.get("cache-control")}`);
  r = await get("/fr/annonces?q=appartement%20moins%20de%20300%20000");
  P([200, 307, 308].includes(r.status), `natural search → ${r.status} ${r.headers.get("location") ?? ""}`);
  r = await get("/sitemap.xml");
  P(r.status === 200, `sitemap → ${r.status}`);
  console.log(`\n${checks.filter(Boolean).length}/${checks.length} checks passed`);
  process.exit(checks.every(Boolean) ? 0 : 1);
})();
