export const meta = {
  name: 'mazed-qa-fix',
  description: 'Fix the confirmed QA findings of Mazed Immo, one agent per group of findings in its own worktree, each reviewed',
  phases: [
    { title: 'Fix', detail: 'one agent per group, isolated worktree, branch fix/<slug> from the branch under test' },
    { title: 'Review', detail: 'an independent reviewer reads each diff' },
  ],
}

// One fix agent per group of findings (make-groups.cjs cuts them), each in its
// own worktree on a branch fix/<slug> taken from origin/<baseBranch>, then an
// independent reviewer per diff. Nothing is pushed or merged: the person who
// runs the tour reads the reviews and merges the fix branches.
//
// The Workflow runtime has no filesystem, so the groups come in through `args`
// (build them with  node scripts/qa/workflow-args.cjs fix <groups.json>):
//   groups          the "groups" of the groups file: [{ slug, migration, file, count }] — file is the
//                   group's findings JSON (absolute path), migration the number reserved for it
//   main            the main checkout: node_modules and .env.local live there; read-only for the agents
//   baseBranch      the branch the fixes build on (default "main"); it must be pushed, the agents fetch it
//   migrationsNote  optional: migrations already on that branch and whether they are applied
//   model           optional: the agents' model (default: the session's)
const MAIN = args.main
const BRANCH = args.baseBranch || 'main'
const GROUPS = args.groups
const AGENT = args.model ? { model: args.model } : {}
if (!MAIN || !Array.isArray(GROUPS) || GROUPS.length === 0) {
  throw new Error('args.main and args.groups are required — build them with: node scripts/qa/workflow-args.cjs fix <groups.json>')
}

const RULES = `
MAZED IMMO (www.mazed.immo): Tunisian real-estate classifieds, Next.js 16 app router + Supabase, French (/fr, default) and Arabic (/ar, RTL; Derja register in messages/ar.json). You work in your OWN git worktree (your working directory), a checkout of this repository. The main checkout, with node_modules and .env.local, is ${MAIN} — never edit files there, never touch the other worktrees under ${MAIN}/.claude/worktrees (they belong to other agents).

SET UP FIRST (in your worktree, before reading code — the worktree was made from main, which may be BEHIND the work you build on):
  git fetch origin && git checkout -B fix/<slug> origin/${BRANCH}        # <slug> = the one given below
Do NOT create a node_modules junction or copy .env.local: your worktree sits under the main checkout, so Node and TypeScript resolve packages from ${MAIN}/node_modules by walking up. Run the tools by absolute path, from your worktree root:
  node "${MAIN}/node_modules/typescript/bin/tsc" --noEmit -p tsconfig.json
  node "${MAIN}/node_modules/eslint/bin/eslint.js" --max-warnings=0 <files you touched>
  node "${MAIN}/node_modules/vitest/vitest.mjs" run --project unit <related test files, or nothing for all>
  node scripts/i18n-check.mjs        (whenever you touched messages)
All four must pass before you commit. Never run next build or next dev. Never write to the live database (no scripts against .env.local); read it only if a question cannot be answered from the code, through ${MAIN}/.env.local, and never print its values.

HOW THIS REPO IS WRITTEN (match it): plain-English comments that say WHY, not what; every user-facing text lives in messages/fr.json AND messages/ar.json (same keys, same ICU placeholders; Arabic in Tunisian Derja for the public site; the files are CRLF — edit them with the Edit tool, never rewrite them whole); every number a feature depends on is a setting in src/lib/settings/registry.ts (with settingsRegistry.<key>.label/hint in both languages); every logged action code (logAction) has a label in adminActions (key = code with dots replaced by underscores) — the test src/lib/admin/actions.test.ts enforces it; admin API routes call requireAdmin(req, "<section>") from src/lib/admin/guard.ts; mutating routes check isSameOrigin; listings are written only by the server (service role); ids from a request are checked with isUuid (src/lib/uuid.ts) before they reach Postgres; a storage object's existence is checked with objectExists (src/lib/listings/storage.ts). Dark-on-dark is forbidden: text on --gold is text-[var(--background)].
Tests: vitest unit tests live next to the code (*.test.ts); add or adjust one when the fix is logic you can test without the database.
A migration, if truly needed, goes in supabase/migrations/<NUMBER>_<slug>.sql (NUMBER given below) with its rollback in supabase/rollbacks/<NUMBER>_<slug>.down.sql and a row at the top of the table in supabase/rollbacks/README.md — do NOT apply it; say so in your result.${args.migrationsNote ? ` Migrations already on the branch: ${args.migrationsNote}` : ''}
Commit on your branch with git (author is preconfigured): subject = a plain-English sentence of what changed, a body that says why (one line per finding), and end with the trailer line  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Do not push. Do not merge. Keep each change focused (no drive-by refactors), fix the root cause rather than the symptom, and fix every place the same bug appears. If a finding is wrong or by design once you read the code, say so in notes instead of changing code.`

const RESULT = {
  type: 'object',
  required: ['slug', 'branch', 'commit', 'summary', 'files', 'checks', 'needsMigration', 'perFinding', 'notes'],
  properties: {
    slug: { type: 'string' },
    branch: { type: 'string' },
    commit: { type: 'string', description: 'short sha of your last commit, or "" when nothing was committed' },
    summary: { type: 'string', description: 'what changed and why, three or four sentences' },
    files: { type: 'array', items: { type: 'string' } },
    checks: { type: 'string', description: 'tsc / eslint / vitest / i18n results, verbatim one-liners' },
    needsMigration: { type: 'boolean' },
    perFinding: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'status', 'how'],
        properties: {
          title: { type: 'string' },
          status: { type: 'string', enum: ['fixed', 'partly', 'skipped', 'by_design'] },
          how: { type: 'string', description: 'one or two sentences: what was changed, or why not' },
        },
      },
    },
    notes: { type: 'string', description: 'anything not fixed, doubts, follow-ups for the person who merges' },
  },
}

const REVIEW = {
  type: 'object',
  required: ['ok', 'issues', 'summary'],
  properties: {
    ok: { type: 'boolean', description: 'safe to merge as is' },
    issues: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
}

function fixPrompt(f) {
  return `${RULES}

YOUR GROUP — slug: ${f.slug} · migration number if you need one: ${f.migration}
Read your findings (JSON, ${f.count} of them, with repro, expected, actual and a suggested fix — a hint, not an order) in: ${f.file}
Its "done" field says what is ALREADY fixed on the branch so you do not redo it.
Fix every finding in the file. Order: the medium ones first, then the low ones. One commit for the whole group is fine (or a few). Set slug = "${f.slug}" in your result, and fill perFinding with one entry per finding, in the file's order.`
}

function reviewPrompt(f, r) {
  return `You review a group of fixes in the Mazed Immo repository. Main checkout (read-only for you): ${MAIN}. The fixes are on branch ${r.branch} (last commit ${r.commit}), made in another worktree of the same repository; read them with  git -C "${MAIN}" log --oneline origin/${BRANCH}..${r.branch}  and  git -C "${MAIN}" diff origin/${BRANCH}...${r.branch}  (and git show for single commits).
The findings they fix are listed in ${f.file} (JSON: title, where, repro, expected, actual, suggestedFix).
The fixer says: ${r.summary}
Per finding: ${JSON.stringify(r.perFinding)}
Checks: ${r.checks}
Judge: does the diff fix each finding's root cause everywhere it appears, without breaking the flows around it? Are fr and ar messages both updated with the same ICU placeholders, and does every new logAction code have an adminActions label? Any dark-on-dark, missing same-origin or admin gate, raw id reaching Postgres, missing test, or style that does not match the repo? Set ok=false only for a real problem that must be fixed before merge, and list the issues precisely (file:line, what is wrong, what to do).`
}

phase('Fix')
log(`${GROUPS.length} groups, each in its own worktree, from origin/${BRANCH}`)
const results = await pipeline(
  GROUPS,
  (f) => agent(fixPrompt(f), { label: `fix:${f.slug}`, phase: 'Fix', schema: RESULT, isolation: 'worktree', ...AGENT }),
  async (r, f) => {
    if (!r || !r.commit) return { fix: f, result: r, review: null }
    const review = await agent(reviewPrompt(f, r), { label: `review:${f.slug}`, phase: 'Review', schema: REVIEW, ...AGENT })
    return { fix: f, result: r, review }
  },
)
const out = results.filter(Boolean)
log(`fixed: ${out.filter((x) => x.result?.commit).length}/${GROUPS.length} · review ok: ${out.filter((x) => x.review?.ok).length}`)
return out
