// summarize.cjs — read a Workflow run's output and print the wave: per area its
// checks and findings with verdicts and votes (for regression areas, the
// FIXED/STILL/UNTESTABLE tally), then the totals. With a second argument it
// also saves the bare result array — the "wave file" that make-groups.cjs cuts
// into fix groups and that a regression wave re-runs (args.findings).
//   node scripts/qa/summarize.cjs <workflow output file> [save-as.json]
// The output file may be the raw result (a JSON array), the tool's wrapper
// ({ result: [...] }) or a log with the array somewhere inside it.
const fs = require("node:fs");
const [file, saveAs] = process.argv.slice(2);
if (!file) { console.error("usage: node summarize.cjs <workflow output file> [save-as.json]"); process.exit(1); }
const raw = fs.readFileSync(file, "utf8");
let parsed = null; try { parsed = JSON.parse(raw); } catch {}
const start = raw.indexOf("[{");
const end = raw.lastIndexOf("}]");
let out = parsed && Array.isArray(parsed.result) ? parsed.result : null;
if (!out) try {
  out = JSON.parse(raw.slice(start, end + 2));
} catch (e) {
  // the file may hold the result wrapped; try the whole thing
  out = JSON.parse(raw);
  if (!Array.isArray(out)) out = out.result ?? out;
}
if (saveAs) fs.writeFileSync(saveAs, JSON.stringify(out, null, 1));
const short = (s, n) => String(s ?? "").replace(/\s+/g, " ").slice(0, n);
for (const r of out) {
  console.log(`\n=== ${r.area} · checks ${JSON.stringify(r.checks)} · ${r.findings.length} findings`);
  if (/^regress/.test(r.area)) {
    const lines = String(r.notes).split("\n").filter((l) => /^\s*\d+\.\s*(FIXED|STILL|UNTESTABLE|CONFIG)|^(FIXED|STILL|UNTESTABLE|CONFIG)\s*[—-]/.test(l));
    for (const l of lines) console.log("   " + short(l, 150));
  }
  for (const f of r.findings) {
    const votes = (f.votes || []).map((v) => `${v.lens}:${v.couldTest ? (v.refuted ? "REFUTED" : "ok") : "n/t"}`).join(",");
    console.log(` - [${f.verdict}] ${f.severity.toUpperCase().padEnd(8)} ${f.kind.padEnd(10)} ${short(f.title, 140)}`);
    console.log(`      where: ${short(f.where, 160)}`);
    if (votes) console.log(`      votes: ${votes}`);
  }
}
const all = out.flatMap((r) => r.findings.map((f) => ({ ...f, area: r.area })));
const kept = all.filter((f) => f.verdict !== "refuted");
console.log(`\nTOTAL ${all.length} findings, ${kept.length} kept (${kept.filter((f) => f.severity === "critical").length} critical, ${kept.filter((f) => f.severity === "high").length} high, ${kept.filter((f) => f.severity === "medium").length} medium, ${kept.filter((f) => f.severity === "low").length} low)`);
