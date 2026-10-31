// Smoke test of qa-lib against the QA server: account, pages, a draft, submit, cleanup.
// Run it before launching a wave of agents: it proves the server, .env.local and the
// helper agree. Creates two [TEST] accounts and one [TEST] draft, removes them at the end.
//   node scripts/qa/smoke.cjs
const qa = require("./qa-lib.cjs");
(async () => {
  const t0 = Date.now();
  try {
    let r = await qa.get(null, "/fr");
    qa.P(r.status === 200 && r.text.includes("Mazed Immo"), `home fr answers (${Date.now() - t0} ms)`, r.status);
    r = await qa.get(null, "/ar/annonces");
    qa.P(r.status === 200 && r.text.includes('dir="rtl"'), "catalogue ar is RTL", r.status);
    const u = await qa.makeUser({ label: "smoke" });
    r = await qa.get(u, "/fr/account");
    qa.P(r.status === 200 && r.text.includes(u.fullName), "signed-in account page shows the test name", r.status);
    const id = await qa.makeListing(u);
    r = await qa.call(u, "POST", `/api/annonces/${id}/submit`);
    qa.P(r.status === 200 && ["pending_review", "published"].includes(r.json?.status), `draft submits (${r.json?.status}, ${r.json?.paidWith})`, r.json);
    const a = await qa.makeUser({ label: "smokeadmin", role: "admin" });
    r = await qa.get(a, "/fr/admin/annonces");
    qa.P(r.status === 200 && r.text.includes("[TEST] Appartement"), "admin sees the test annonce in the queue", r.status);
    r = await qa.get(null, "/fr/admin/annonces");
    qa.P(r.status !== 200 || !r.text.includes("[TEST] Appartement"), "anonymous does not get the console data", r.status);
  } finally {
    await qa.cleanup();
    console.log(JSON.stringify(qa.report()).slice(0, 300));
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
