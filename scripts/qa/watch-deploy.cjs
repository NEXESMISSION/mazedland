// Wait for the production deployment of a given commit sha (GitHub Actions →
// vercel deploy --prod). Token and ids as in vercel-status.cjs. Exit code 0 when
// READY, 1 when the deployment failed, 2 on timeout.
//   node scripts/qa/watch-deploy.cjs <sha7> [maxMinutes]
const cfg = require("./config.cjs");
cfg.loadEnv();
const token = (process.env.VERCEL_TOKEN || "").trim();
if (!token) { console.error("no VERCEL_TOKEN in .env.local"); process.exit(1); }
const { projectId: PROJECT, teamId: TEAM } = cfg.vercel;
if (!PROJECT || !TEAM) { console.error("vercel.projectId / vercel.teamId are missing in scripts/qa/config.json"); process.exit(1); }
const [sha, max] = process.argv.slice(2);
if (!sha) { console.error("usage: node watch-deploy.cjs <sha7> [maxMinutes]"); process.exit(1); }
const deadline = Date.now() + Number(max || 15) * 60_000;
(async () => {
  while (Date.now() < deadline) {
    const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT}&teamId=${TEAM}&target=production&limit=6`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json();
    const hit = (j.deployments || []).find((d) => (d.meta?.githubCommitSha || "").startsWith(sha));
    if (hit) {
      console.log(`${new Date().toISOString()} ${hit.state} ${hit.url}`);
      if (hit.state === "READY") { console.log("DEPLOYED"); process.exit(0); }
      if (hit.state === "ERROR" || hit.state === "CANCELED") { console.log("FAILED"); process.exit(1); }
    } else {
      console.log(`${new Date().toISOString()} no deployment for ${sha} yet`);
    }
    await new Promise((res) => setTimeout(res, 30_000));
  }
  console.log("TIMEOUT"); process.exit(2);
})();
