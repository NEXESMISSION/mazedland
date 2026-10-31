// GitHub REST through the token Git Credential Manager holds for github.com
// (gh is not signed in on this machine). The repository and the branch its pull
// requests target come from config.json (github.repo / github.base) or from
// QA_GITHUB_REPO / QA_GITHUB_BASE.
//   node scripts/qa/gh-api.cjs pr-create <head> <title> <bodyFile>
//   node scripts/qa/gh-api.cjs pr-status <number>
//   node scripts/qa/gh-api.cjs checks <sha>
//   node scripts/qa/gh-api.cjs merge <number> <commitTitle>
// Never prints the token.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const cfg = require("./config.cjs");

const REPO = cfg.github.repo;
const BASE = cfg.github.base;
if (!REPO) { console.error("github.repo is missing in scripts/qa/config.json (or set QA_GITHUB_REPO)"); process.exit(1); }

function token() {
  const out = execSync("git credential fill", { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error("no github token in the credential store");
  return m[1].trim();
}

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json;
}

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "pr-create") {
    const pr = await api("POST", `/repos/${REPO}/pulls`, { title: b, head: a, base: BASE, body: fs.readFileSync(c, "utf8") });
    console.log(`PR #${pr.number} ${pr.html_url}`);
  } else if (cmd === "pr-status") {
    const pr = await api("GET", `/repos/${REPO}/pulls/${a}`);
    console.log(JSON.stringify({ number: pr.number, state: pr.state, merged: pr.merged, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state, head: pr.head.sha, url: pr.html_url }));
  } else if (cmd === "checks") {
    const r = await api("GET", `/repos/${REPO}/commits/${a}/check-runs`);
    for (const run of r.check_runs) console.log(`${run.name}: ${run.status} ${run.conclusion ?? ""}`);
    if (r.check_runs.length === 0) console.log("(no check runs yet)");
  } else if (cmd === "merge") {
    const r = await api("PUT", `/repos/${REPO}/pulls/${a}/merge`, { merge_method: "merge", commit_title: b });
    console.log(JSON.stringify({ merged: r.merged, sha: r.sha, message: r.message }));
  } else {
    console.error("usage: pr-create <head> <title> <bodyFile> | pr-status <n> | checks <sha> | merge <n> <title>");
    process.exit(1);
  }
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
