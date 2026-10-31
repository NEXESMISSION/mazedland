// Global sweep of [TEST] data left on the live DB by testers that died before
// their own cleanup: every [TEST] profile and all it owns, [TEST]-titled rows
// that belong to nobody, [TEST] products/ads/popups, test backup files.
//   node sweep.cjs            → report only
//   node sweep.cjs --apply    → remove
const qa = require("./qa-lib.cjs");
const APPLY = process.argv.includes("--apply");
const svc = qa.svc;
(async () => {
  const { data: profiles } = await svc.from("profiles").select("id, full_name, created_at").ilike("full_name", "[TEST]%");
  const users = (profiles ?? []).map((p) => p.id);
  const { data: listings } = await svc.from("listings").select("id, title, seller_id").ilike("title", "[TEST]%");
  const { data: shops } = await svc.from("shops").select("id, name").ilike("name", "[TEST]%");
  const { data: products } = await svc.from("products").select("id, slug, name_fr").or("slug.ilike.%test%,name_fr.ilike.[TEST]%");
  const { data: ads } = await svc.from("ads").select("id, title").ilike("title", "[TEST]%").then((r) => r, () => ({ data: [] }));
  const { data: popups } = await svc.from("popups").select("id, title").ilike("title", "[TEST]%").then((r) => r, () => ({ data: [] }));
  const { data: requests } = await svc.from("property_requests").select("id, user_id").in("user_id", users.length ? users : ["00000000-0000-0000-0000-000000000000"]);
  const { data: files } = await svc.storage.from("backups").list("", { limit: 100 });
  const since = new Date(Date.now() - 6 * 3600_000);
  const testFiles = (files ?? []).filter((f) => new Date(f.created_at) > since).map((f) => f.name);
  const { data: objs } = users.length ? await svc.storage.from("properties").list("", { limit: 1000 }) : { data: [] };
  const ownedFolders = (objs ?? []).filter((o) => o.id === null && users.includes(o.name)).map((o) => o.name);
  console.log(`[TEST] profiles: ${users.length} · [TEST] listings: ${(listings ?? []).length} · [TEST] shops: ${(shops ?? []).length} · test products: ${(products ?? []).length} · test ads: ${(ads ?? []).length} · test popups: ${(popups ?? []).length} · demandes: ${(requests ?? []).length} · backup files (6h): ${testFiles.length} · photo folders: ${ownedFolders.length}`);
  for (const p of profiles ?? []) console.log("   ", p.id, p.full_name, p.created_at.slice(0, 16));
  if (!APPLY) return;

  for (const r of requests ?? []) qa.made.requests.push(r.id);
  for (const s of shops ?? []) qa.made.shops.push(s.id);
  for (const l of listings ?? []) qa.made.listings.push(l.id);
  for (const p of products ?? []) qa.made.extra.push({ table: "products", id: p.id });
  for (const a of ads ?? []) { qa.made.extra.push({ table: "ad_daily", id: a.id, column: "ad_id" }); qa.made.extra.push({ table: "ads", id: a.id }); }
  for (const p of popups ?? []) { qa.made.extra.push({ table: "popup_views", id: p.id, column: "popup_id" }); qa.made.extra.push({ table: "popups", id: p.id }); }
  for (const u of users) qa.made.users.push(u);
  // Photos of test accounts: everything under properties/<userId>/.
  for (const folder of ownedFolders) {
    const walk = async (prefix) => {
      const { data } = await svc.storage.from("properties").list(prefix, { limit: 1000 });
      for (const e of data ?? []) {
        const p = `${prefix}/${e.name}`;
        if (e.id === null) await walk(p); else qa.made.photos.push(p);
      }
    };
    await walk(folder);
  }
  await qa.cleanup();
  // Backup files are never removed here: the user's own « Sauvegarde » clicks live in the same bucket.
  const { count } = await svc.from("profiles").select("id", { count: "exact", head: true }).ilike("full_name", "[TEST]%");
  const { count: l } = await svc.from("listings").select("id", { count: "exact", head: true }).ilike("title", "[TEST]%");
  console.log(`after sweep: ${count} [TEST] profiles, ${l} [TEST] listings`);
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
