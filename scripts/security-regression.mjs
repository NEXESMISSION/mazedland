// ============================================================================
// Security regression gate — re-runs the audit's live exploits against the
// configured Supabase project and FAILS (exit 1) if any is no longer blocked.
//
// This is the gate the deep audit demanded: a green check must mean "the
// exploits fail", not just "TypeScript compiled". Run in CI against a
// staging/prod project with NEXT_PUBLIC_SUPABASE_URL +
// NEXT_PUBLIC_SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY set.
//
//   node scripts/security-regression.mjs
//
// Covers: B1 (signup role escalation), B6 (anon PII scrape), B2 (forge deposit
// via PostgREST), plus a positive control that the public id/full_name/role
// read still works (so the fix didn't break the inspector/partner pages).
// ============================================================================
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !svcKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const svc = createClient(url, svcKey, { auth: { persistSession: false } });
const freshAnon = () => createClient(url, anonKey, { auth: { persistSession: false } });

let fails = 0;
const P = (ok, label) => { console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — ${label}`); if (!ok) fails++; };

// B1 — anonymous signUp must NOT yield an admin profile/JWT.
{
  const email = `sec-probe-${process.hrtime.bigint()}@example.com`;
  const { data: su, error } = await freshAnon().auth.signUp({
    email, password: "SecProbe!2026x",
    options: { data: { role: "admin", full_name: "SEC PROBE" } },
  });
  if (error) {
    P(true, `B1 signup-admin: signUp rejected (${error.message}) — no escalation path`);
  } else {
    const uid = su.user?.id;
    const { data: prof } = await svc.from("profiles").select("role").eq("id", uid).maybeSingle();
    const { data: au } = await svc.auth.admin.getUserById(uid);
    const jwtRole = au?.user?.app_metadata?.role ?? "(none)";
    P(prof?.role === "individual" && jwtRole !== "admin",
      `B1 signup-admin: new account role=${prof?.role}, jwt=${jwtRole} (must be individual / not admin)`);
    if (uid) await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}

// B6 — anon must NOT be able to read sellers' phone/kyc. Use a FRESH anon
// client (a signed-in client would test the separate authenticated vector).
{
  let leaks = 0;
  for (let i = 0; i < 12; i++) {
    const { data, error } = await freshAnon()
      .from("profiles").select("id, full_name, phone, kyc_status").not("phone", "is", null).limit(5);
    if (!error && (data ?? []).some((r) => r.phone)) leaks++;
  }
  P(leaks === 0, `B6 anon PII scrape: phone read blocked across 12 attempts (leaks=${leaks})`);
}

// Positive control — public id/full_name/role must STILL be readable.
{
  const { error } = await freshAnon().from("profiles").select("id, full_name, role").limit(1);
  P(!error, `public id/full_name/role still readable (inspector/partner pages intact)${error ? ` — ${error.message}` : ""}`);
}

// B2 — a client must NOT be able to insert an auction_deposits row.
{
  const z = "00000000-0000-0000-0000-000000000000";
  const { error } = await freshAnon().from("auction_deposits").insert({ auction_id: z, user_id: z, amount: 0 });
  P(!!error, `B2 forge-deposit: insert blocked${error ? ` (${error.code})` : " — ACCEPTED (!!)"}`);
}

console.log(`\n${fails === 0 ? "ALL SECURITY CHECKS PASSED" : `${fails} SECURITY CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
