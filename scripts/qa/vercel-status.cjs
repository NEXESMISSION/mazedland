// Production deployments of the project on Vercel. The token is VERCEL_TOKEN in
// the main checkout's .env.local (never printed); the project and team ids come
// from config.json (vercel.projectId / vercel.teamId) or VERCEL_PROJECT_ID /
// VERCEL_TEAM_ID.
//   node scripts/qa/vercel-status.cjs [limit]
const cfg = require("./config.cjs");
cfg.loadEnv();
const token = (process.env.VERCEL_TOKEN || "").trim();
if (!token) { console.error("no VERCEL_TOKEN in .env.local"); process.exit(1); }
const { projectId: PROJECT, teamId: TEAM } = cfg.vercel;
if (!PROJECT || !TEAM) { console.error("vercel.projectId / vercel.teamId are missing in scripts/qa/config.json"); process.exit(1); }
(async () => {
  const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${PROJECT}&teamId=${TEAM}&target=production&limit=${process.argv[2] || 4}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (!r.ok) { console.error("vercel", r.status, JSON.stringify(j).slice(0, 200)); process.exit(1); }
  for (const d of j.deployments) console.log(`${new Date(d.created).toISOString()} ${d.state.padEnd(8)} ${(d.meta?.githubCommitSha || "").slice(0, 7)} ${d.meta?.githubCommitMessage?.slice(0, 60) || d.source || ""} ${d.url}`);
})();
