# QA tour

How the whole site gets tested, fixed and re-tested by agents: over HTTP, against a production build of the branch under test, on the **live database** with `[TEST]` rows only. This is the harness of the tour of 2026-10-29/30 (about 140 findings in four waves, shipped as PRs #34 and #39 with migrations 0190–0202), moved here from a session scratchpad so the tour can be run again from a fresh session.

Two kinds of files. `test-workflow.js` and `fix-workflow.js` are scripts for Claude Code's **Workflow** tool: they orchestrate the agents. Everything else is plain Node, run from the main checkout as `node scripts/qa/<file>`.

## Hard rules

The database behind `.env.local` is production; there is no test project. Every agent prompt carries these rules. Keep them when you edit a prompt.

1. **Live database, `[TEST]` rows only.** Create only `[TEST]`-tagged data (the helper does: `[TEST]` names and titles, `+2161…` phones that no real line uses, SMS off on every test profile), act only on rows you created, never modify or delete real users, annonces, agences, payments, products or settings, never use admin bulk actions on real rows. Everything the helper creates is tracked and removed by `qa.cleanup()`; `sweep.cjs` removes what a crashed tester left.
2. **Never an SMS, never an e-mail.** Never call `/api/auth/phone/send` with a valid number, never call `/api/cron/*` with the real secret, never flip SMS preferences on real profiles. Admin-kind notifications (the `qa_report` bell) are the only messages the tour sends.
3. **At most two real AI calls** (`/api/ai/*`) per agent run. The site has a daily budget.
4. **Never `POST /api/admin/settings` with values, never send a broadcast** (`POST /api/admin/notifications/broadcast`): auth checks only.
5. Never print a value from `.env.local`. Never touch the `backups` bucket except files you created. Agents never start servers, never run `next dev` or `next build`, never edit the repo, never use browser tools: HTTP against the QA server only.
6. The rate limiter is per IP and every agent shares localhost: a 429 on an auth route under load is not a bug. Space such calls, never loop on them.

## What you need

- The main checkout with `node_modules` and a filled `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (the helper's service-role client), `SB_HOST`, `SB_REF`, `SB_DB_PASSWORD` (its pg client, for the profile and audit writes the REST API refuses), and `VERCEL_TOKEN` for the deploy scripts.
- `config.json`, read by `config.cjs`. Every key has an environment override:

| key | env | meaning | default |
|---|---|---|---|
| `repoRoot` | `QA_ROOT` | the main checkout (node_modules, `.env.local`) | the checkout this folder sits in |
| `codeDir` | `QA_CODE` | the checkout the QA server was built from: a worktree on the branch under test | `repoRoot` |
| `workDir` | `QA_WORK` | where the agents write scripts, logs and findings | `scripts/qa/work` (gitignored) |
| `baseUrl` | `QA_BASE` | the QA server | `http://localhost:3009` |
| `baseBranch` | `QA_BASE_BRANCH` | the branch under test; fix branches start from `origin/<it>` | `main` |
| `prodUrl` | `QA_PROD_URL` | the live site, for `verify-prod.cjs` | `https://www.mazed.immo` |
| `github.repo`, `github.base` | `QA_GITHUB_REPO`, `QA_GITHUB_BASE` | for `gh-api.cjs` | `lassadmazed-oss/mazedland`, `main` |
| `vercel.projectId`, `vercel.teamId` | `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | the production deployments | the mazedland project |

`node scripts/qa/config.cjs` prints the resolved values. Always run the scripts from the main checkout: the helper loads its packages and `.env.local` from `repoRoot`, not from the worktree under test. `QA_SERVER_LOG` (optional) names the file the QA server's output goes to, so `qa.serverLog(since)` can show a tester the server-side error behind a 500.

- A Claude Code session with the Workflow tool, for steps 3 to 5. A workflow script cannot read files, so `workflow-args.cjs` turns `config.json` (and the groups file) into the `args` you pass it.

## The steps

### 1. Build a production bundle of the branch under test, in a worktree

The main checkout stays on `main`; the code under test lives in a worktree under `.claude/worktrees/` (excluded from git, eslint and tsc). A worktree has no `node_modules` and no `.env.local`: link the first, copy the second, then build with `TURBOPACK_ROOT_OVERRIDE` pointing at the main checkout. Without it Turbopack refuses the junction (« points out of the filesystem root »); `next.config.ts` reads the variable and uses it as the root.

```bash
git worktree add .claude/worktrees/qa qa-tour
```
```bash
cmd /c mklink /J ".claude\worktrees\qa\node_modules" "node_modules"
```
```bash
cp .env.local .claude/worktrees/qa/.env.local
```
```bash
cd .claude/worktrees/qa && TURBOPACK_ROOT_OVERRIDE="C:/path/to/the/main/checkout" npx next build
```

Write the override as a Windows path with forward slashes (in PowerShell: `$env:TURBOPACK_ROOT_OVERRIDE = "C:/…"; npx next build`). The build takes about four minutes: run it in the background. The Bash tool's working directory resets to the main checkout between calls, so `cd` into the worktree explicitly each time. Never delete a worktree folder with `rm -rf` or `Remove-Item -Recurse`: both follow the junction into the main `node_modules`. Use `cmd /c rmdir /s /q "<path>"`.

Set `codeDir` (or `QA_CODE`) to the worktree and `baseBranch` to its branch.

### 2. Start it on :3009

From the worktree, `npm run start -- -p 3009`. Or add this entry to the worktree's own `.claude/launch.json` (gitignored) and use `preview_start {name: "mazed-qa-3009"}`:

```json
{ "name": "mazed-qa-3009", "runtimeExecutable": "npm", "runtimeArgs": ["run", "start", "--", "-p", "3009"], "port": 3009 }
```

Then prove the chain works before spending agent tokens:

```bash
node scripts/qa/smoke.cjs
```

It makes two `[TEST]` accounts and a `[TEST]` draft through the real API, checks a few pages as each of them, and removes everything.

### 3. Run the test workflow, per area

One finder agent per area; then every finding is re-run by an independent verifier, and critical or high ones also get a code reader. Areas: `auth`, `publish`, `buyer`, `console`, `pro`, `payments`, `notify`, `data`, `cross`, `ai`, `public`; the briefs are the `AREAS` table of `test-workflow.js`. Three or four areas per wave: a wave is a long run and the agents share one rate limiter. The 2026-10-30 tour ran `auth publish buyer console`, then `pro payments notify`, then `data cross ai public`.

```bash
node scripts/qa/workflow-args.cjs test auth publish buyer console
```

Pass the printed JSON as `args` to the Workflow tool with `scriptPath: scripts/qa/test-workflow.js` (a JSON value, not a string). `--model` picks the agents' model (default `sonnet`). From the second wave on, `--known <wave.json>` (repeatable) lists the earlier waves' findings so they are not reported again.

The result is an array of area objects `{ area, checks, notes, findings[] }`. Each finding has `title, severity, kind, where, repro, expected, actual, suggestedFix, confidence`, its verifiers' `votes` and a `verdict`: `confirmed`, `disputed` or `refuted`. Save the tool result to a file, then:

```bash
node scripts/qa/summarize.cjs <result file> scripts/qa/work/wave1.json
```

prints the wave and saves the **wave file** the next steps read. The agents also leave `<workDir>/<area>/findings.json` and `progress.json` as they go: that is what survives when a run is cut off, and a re-run of the same area reads and reuses it.

### 4. Run the fix workflow, per group

Cut the confirmed findings into groups, one agent each, by editing the `GROUPS` table of `make-groups.cjs`: a slug, a reserved migration number (two agents must never pick the same one), which findings the group takes, and what is already done on the branch so the agent does not redo it. Keep the groups disjoint. `make-groups2.cjs` is the second template, with a list of findings kept for the main session. Then:

```bash
node scripts/qa/make-groups.cjs scripts/qa/work/wave1.json
```
```bash
node scripts/qa/workflow-args.cjs fix scripts/qa/work/fixes/groups-wave1.json --base-branch qa-tour --note "0190 and 0191 are on the branch and applied"
```

Pass the JSON as `args` with `scriptPath: scripts/qa/fix-workflow.js`. Each fix agent works in an isolated worktree on `fix/<slug>` taken from `origin/<baseBranch>` (push the branch under test first), runs `tsc`, `eslint`, `vitest` and `i18n-check`, commits with the repo's conventions and pushes nothing; a reviewer reads each diff and says whether it is safe to merge. Then, by hand: read the reviews, merge the `fix/*` branches into the branch under test, apply the migrations they wrote (each comes with a rollback), rebuild (step 1) and restart (step 2).

The data-layer findings (policies, grants, triggers, buckets) were fixed by hand in the main session during the last tour: an agent in a worktree cannot see the database. The two live breakages of that tour came from its own migrations, which is why step 5 exists.

### 5. Run the regression areas

On the rebuilt server, re-run the saved findings of each area: `regress:<area>` takes the findings of that area from the wave file (`regress:auth+publish` takes several into one agent). The agents report what is `STILL` broken and anything `NEW` the fixes broke; `--fix-notes` tells them what changed, so a different error code for the right behaviour is not reported as a regression.

```bash
node scripts/qa/workflow-args.cjs test regress:auth regress:publish regress:buyer regress:console --findings scripts/qa/work/wave1.json --fix-notes "an admin's archive now records a takedown and relist answers 403 taken_down; …"
```

Same workflow script. Summarize to `regress1.json`: its `STILL` and `NEW` items are the next fix round (back to step 4) or decisions for the owner. For a second regression of the same areas, `--prefix regress2` keeps the work folders apart. Run the regression before declaring a round done.

## After the tour

| script | what |
|---|---|
| `notify-admin.cjs found <found> <critical>` · `fixed <fixed> <left>` | the admins' bell (kind `qa_report`; admin kinds never go out by SMS or e-mail) |
| `sweep.cjs` · `sweep.cjs --apply` | report, then remove, every `[TEST]` row a dead tester left (never the `backups` files) |
| `gh-api.cjs pr-create <head> <title> <bodyFile>` · `checks <sha>` · `pr-status <n>` · `merge <n> <title>` | GitHub through the token Git Credential Manager holds |
| `vercel-status.cjs [limit]` · `watch-deploy.cjs <sha7> [minutes]` | the production deployments; wait for one commit to be READY |
| `verify-prod.cjs` | read-only checks of the live site after a deploy |

## Files

| file | role |
|---|---|
| `config.json`, `config.cjs` | where things are (table above) |
| `qa-lib.cjs` | the helper every agent script requires: `[TEST]` users (signed-in cookies, scoped admins), HTTP calls with same-origin headers, photo upload, drafts through the real API, tracking and `cleanup()`, service-role and pg clients |
| `smoke.cjs` | proves server, `.env.local` and helper agree |
| `test-workflow.js` | Workflow script: finders, verifiers, regression areas |
| `fix-workflow.js` | Workflow script: fixers in worktrees, a reviewer each |
| `workflow-args.cjs` | builds the `args` of both from `config.json` and the groups file |
| `summarize.cjs` | prints a wave, saves the wave file |
| `make-groups.cjs`, `make-groups2.cjs` | wave file → group files + groups file (the two templates of the last tour) |
| `notify-admin.cjs`, `sweep.cjs`, `gh-api.cjs`, `vercel-status.cjs`, `watch-deploy.cjs`, `verify-prod.cjs` | after the tour |
| `work/` | gitignored: the agents' scripts, logs and findings, the wave files, the groups |
