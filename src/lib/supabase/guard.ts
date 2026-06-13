/**
 * DB-identity guard — prevents the "wrong database" incident.
 *
 * A deploy whose NEXT_PUBLIC_SUPABASE_URL points at a SIBLING app's Supabase
 * project already happened in production: the batta (real-estate) deploy was
 * wired to the car project's database and served car listings. Nothing caught
 * it because the URL and keys are mutually consistent — they were just the
 * WRONG project.
 *
 * The fix: commit the project ref this app is built for, HERE, as an
 * independent source of truth from the runtime env. The ref is not secret (it
 * is already in the public NEXT_PUBLIC_SUPABASE_URL), so committing it is safe,
 * and it differs per app (a skin value: auto vs batta). If the env URL's ref
 * doesn't match, the Supabase client factories THROW — we refuse to serve
 * rather than read/write another tenant's auth cookies, payments, KYC and bids.
 *
 * Override: set EXPECTED_SUPABASE_REF for a legitimate DB move without a code
 * change. If neither the committed default nor the override is present, the
 * guard no-ops (with a warning) so dev forks / fresh clones aren't bricked.
 */

// The Supabase project ref this codebase is built for. AUTO (cars).
// The batta repo commits "sajxoovrsoacfnytiijv".
const EXPECTED_REF_DEFAULT = "sajxoovrsoacfnytiijv";

/** Extract the `<ref>` from https://<ref>.supabase.co (or .in/.net). */
function refFromUrl(url: string): string | null {
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)/i.exec(url);
  return m ? m[1] : null;
}

let warnedNoExpected = false;

/**
 * Returns a human-readable problem string if the connected DB is the wrong
 * project, or null if it's fine (or the guard is disabled). Non-throwing —
 * use for boot logging.
 */
export function checkSupabaseRef(url: string | undefined | null): string | null {
  if (!url) return null; // missing-env is the caller's own concern
  const expected = (process.env.EXPECTED_SUPABASE_REF || EXPECTED_REF_DEFAULT || "").trim();
  if (!expected) {
    if (!warnedNoExpected) {
      warnedNoExpected = true;
      console.warn("[db-guard] no EXPECTED_SUPABASE_REF set — DB-identity guard disabled");
    }
    return null;
  }
  const actual = refFromUrl(url);
  if (actual && actual !== expected) {
    return (
      `WRONG DATABASE: NEXT_PUBLIC_SUPABASE_URL points at Supabase project '${actual}', ` +
      `but this app is built for '${expected}'. Refusing to use it — fix the deployment's ` +
      `Supabase env vars (or set EXPECTED_SUPABASE_REF if this DB move is intentional).`
    );
  }
  return null;
}

/** Throws if the connected DB is the wrong project. Call in client factories. */
export function assertSupabaseRef(url: string | undefined | null): void {
  const problem = checkSupabaseRef(url);
  if (problem) throw new Error(`[db-guard] ${problem}`);
}
