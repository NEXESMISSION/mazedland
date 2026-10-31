// workflow-args.cjs — print the `args` for the two Workflow scripts, built from
// config.json, so nothing about this machine is typed into a prompt by hand.
// The Workflow runtime has no filesystem: the scripts only see what args carry.
//
//   node scripts/qa/workflow-args.cjs test <area...> [--model sonnet] [--branch <branch>]
//        [--findings <wave.json>] [--known <wave.json>]... [--fix-notes "<text>"] [--prefix regress2]
//   node scripts/qa/workflow-args.cjs fix <groups.json> [--base-branch <branch>] [--note "<text>"] [--model <m>]
//
// test: areas are keys of test-workflow.js (auth, publish, …) or regress:<area>[+<area>…];
//       --findings is the saved wave the regression areas re-run; --known lists the
//       non-refuted findings of earlier waves so they are not reported again; the work
//       folder and one folder per area are created.
// fix:  <groups.json> is what make-groups.cjs wrote; its "groups" become args.groups.
// Pass the printed JSON as the Workflow tool's `args` (a JSON value, not a string).
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config.cjs");

const [mode, ...rest] = process.argv.slice(2);
const opts = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith("--")) (opts[a.slice(2)] ??= []).push(rest[++i] ?? "");
  else positional.push(a);
}
const one = (k, d) => (opts[k] ? opts[k][opts[k].length - 1] : d);
const abs = (p) => path.resolve(p).replace(/\\/g, "/");
const readWave = (file) => {
  const wave = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return wave[0] && Array.isArray(wave[0].findings) ? wave.flatMap((r) => r.findings.map((f) => ({ area: r.area, ...f }))) : wave;
};
const regressKey = (prefix, spec) => `${prefix}-${spec.slice("regress:".length).split("+").map((s) => s.trim()).filter(Boolean).join("-")}`;

function usage() {
  console.error([
    "usage: node workflow-args.cjs test <area...> [--model m] [--branch b] [--findings wave.json] [--known wave.json]... [--fix-notes text] [--prefix regress2]",
    "       node workflow-args.cjs fix <groups.json> [--base-branch b] [--note text] [--model m]",
  ].join("\n"));
  process.exit(1);
}

if (mode === "test") {
  if (!positional.length) usage();
  const prefix = one("prefix", "regress");
  const known = (opts.known || []).flatMap((file) => readWave(file).filter((f) => f.verdict !== "refuted").map((f) => ` - [${f.area}] ${f.title}`));
  const args = {
    areas: positional,
    qa: cfg.work,
    lib: cfg.lib,
    code: cfg.code,
    branch: one("branch", cfg.baseBranch),
    base: cfg.baseUrl,
    model: one("model", "sonnet"),
  };
  if (opts.findings) args.findings = abs(one("findings"));
  if (opts["fix-notes"]) args.fixNotes = one("fix-notes");
  if (known.length) args.known = known.join("\n");
  if (prefix !== "regress") args.prefix = prefix;
  // The folders the agents write into, so "work in <qa>/<area>/" is true from the first call.
  fs.mkdirSync(path.join(cfg.work, "verify"), { recursive: true });
  for (const key of positional) fs.mkdirSync(path.join(cfg.work, key.startsWith("regress:") ? regressKey(prefix, key) : key), { recursive: true });
  console.log(JSON.stringify(args, null, 2));
} else if (mode === "fix") {
  const file = positional[0];
  if (!file) usage();
  const parsed = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const groups = Array.isArray(parsed) ? parsed : parsed.groups;
  if (!Array.isArray(groups) || !groups.length) { console.error(`${file}: no groups in it`); process.exit(1); }
  const args = { groups, main: cfg.root, baseBranch: one("base-branch", cfg.baseBranch) };
  if (opts.note) args.migrationsNote = one("note");
  if (opts.model) args.model = one("model");
  console.log(JSON.stringify(args, null, 2));
} else {
  usage();
}
