// config.cjs — where the QA tour runs and what it talks to.
//
// The harness used to carry the absolute paths of one machine (a session
// scratchpad, one worktree). They all live here now, so a fresh session launches
// the tour by editing config.json or exporting a variable, never by editing a
// script.
//
//   config.json key   env override        meaning
//   repoRoot          QA_ROOT             the main checkout: holds node_modules and .env.local
//                                         (default: the checkout this folder sits in)
//   codeDir           QA_CODE             the checkout the QA server was built from — usually a
//                                         worktree on the branch under test (default: repoRoot)
//   workDir           QA_WORK             where the agents write scripts, logs and findings
//                                         (default scripts/qa/work, gitignored)
//   baseUrl           QA_BASE             the QA server: a production build started with next start
//   baseBranch        QA_BASE_BRANCH      the branch that build came from; fix/<slug> branches start
//                                         from origin/<baseBranch>
//   prodUrl           QA_PROD_URL         the live site, for the read-only checks after a deploy
//   github.repo       QA_GITHUB_REPO      owner/name for gh-api.cjs; github.base (QA_GITHUB_BASE) is
//                                         the branch its pull requests target
//   vercel.projectId  VERCEL_PROJECT_ID   the Vercel project and team of the production deployments
//   vercel.teamId     VERCEL_TEAM_ID
//
// Relative paths are resolved against repoRoot. Exported paths use forward
// slashes so they can go into prompts and JSON as they are, on Windows too.
//   node scripts/qa/config.cjs     → prints the resolved values (no secret lives here)
const path = require("node:path");
const fs = require("node:fs");

const HERE = __dirname;
const file = JSON.parse(fs.readFileSync(path.join(HERE, "config.json"), "utf8"));
const slash = (p) => p.replace(/\\/g, "/");
// An environment variable wins over config.json; an empty value counts as unset.
const pick = (env, value) => (process.env[env] || "").trim() || String(value ?? "").trim();

const root = slash(path.resolve(pick("QA_ROOT", file.repoRoot) || path.resolve(HERE, "..", "..")));
const under = (p, fallback) => (p ? slash(path.resolve(root, p)) : fallback);
const noSlash = (u) => u.replace(/\/+$/, "");

const config = {
  root,
  code: under(pick("QA_CODE", file.codeDir), root),
  work: under(pick("QA_WORK", file.workDir), slash(path.join(root, "scripts", "qa", "work"))),
  baseUrl: noSlash(pick("QA_BASE", file.baseUrl) || "http://localhost:3009"),
  baseBranch: pick("QA_BASE_BRANCH", file.baseBranch) || "main",
  prodUrl: noSlash(pick("QA_PROD_URL", file.prodUrl) || "https://www.mazed.immo"),
  github: {
    repo: pick("QA_GITHUB_REPO", file.github && file.github.repo),
    base: pick("QA_GITHUB_BASE", file.github && file.github.base) || "main",
  },
  vercel: {
    projectId: pick("VERCEL_PROJECT_ID", file.vercel && file.vercel.projectId),
    teamId: pick("VERCEL_TEAM_ID", file.vercel && file.vercel.teamId),
  },
  here: slash(HERE),
  // The helper the agents require by absolute path, from wherever their scripts live.
  lib: slash(path.join(HERE, "qa-lib.cjs")),
};

/** Load the main checkout's .env.local into process.env. No script here prints a value from it. */
function loadEnv() {
  require(path.join(root, "node_modules", "dotenv")).config({ path: path.join(root, ".env.local"), quiet: true });
}

module.exports = { ...config, loadEnv };

if (require.main === module) console.log(JSON.stringify(config, null, 2));
