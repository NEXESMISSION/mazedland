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

// B6-AUTH — a LOGGED-IN (non-admin) user must NOT read OTHER users'
// phone/kyc either. This is the vector 0068/0075/0076 left open and 0080
// closes (dropped the broad actor row-policy; cross-user names now come from
// the public_profiles view, never the sensitive columns).
{
  const email = `sec-auth-${process.hrtime.bigint()}@example.com`;
  const password = "SecProbe!2026x";
  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (cErr) {
    P(false, `B6-auth: could not create probe user (${cErr.message})`);
  } else {
    const uid = created.user?.id;
    const authed = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: sErr } = await authed.auth.signInWithPassword({ email, password });
    if (sErr) {
      P(false, `B6-auth: probe sign-in failed (${sErr.message})`);
    } else {
      let leaks = 0;
      for (let i = 0; i < 8; i++) {
        const { data } = await authed
          .from("profiles").select("id, phone, kyc_status")
          .neq("id", uid).not("phone", "is", null).limit(5);
        if (!data) continue;
        if (data.some((r) => r.phone || r.kyc_status)) leaks++;
      }
      P(leaks === 0, `B6-auth PII scrape: logged-in read of OTHERS' phone/kyc blocked (leaks=${leaks})`);

      // Positive control — display names still resolve via the safe view.
      const { error: ppErr } = await authed
        .from("public_profiles").select("id, full_name, role").limit(1);
      P(!ppErr, `public_profiles readable by authenticated (bid history / inspectors intact)${ppErr ? ` — ${ppErr.message}` : ""}`);
    }
    if (uid) await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}

// Positive control — anon public_profiles read still works for the public
// inspector/partner pages (id/full_name/role only).
{
  const { error } = await freshAnon().from("public_profiles").select("id, full_name, role").limit(1);
  P(!error, `anon public_profiles readable (inspector/partner pages intact)${error ? ` — ${error.message}` : ""}`);
}

// B2 — a client must NOT be able to insert an auction_deposits row.
{
  const z = "00000000-0000-0000-0000-000000000000";
  const { error } = await freshAnon().from("auction_deposits").insert({ auction_id: z, user_id: z, amount: 0 });
  P(!!error, `B2 forge-deposit: insert blocked${error ? ` (${error.code})` : " — ACCEPTED (!!)"}`);
}

// ENQ — a logged-in user must NOT be able to call enqueue_notification
// (forged notifications / platform-branded phishing emails). 0082 revokes the
// 6-arg overload from `authenticated`.
{
  const email = `sec-enq-${process.hrtime.bigint()}@example.com`;
  const password = "SecProbe!2026x";
  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) { P(false, `ENQ: probe user create failed (${cErr.message})`); }
  else {
    const uid = created.user?.id;
    const authed = createClient(url, anonKey, { auth: { persistSession: false } });
    await authed.auth.signInWithPassword({ email, password });
    const { error } = await authed.rpc("enqueue_notification", {
      p_user_id: uid, p_kind: "payment_accepted", p_title: "X", p_body: "Y", p_link: "/account/payments", p_payload: {},
    });
    P(!!error, `ENQ enqueue_notification: blocked for authenticated${error ? ` (${error.code ?? (error.message||"").slice(0,40)})` : " — CALLABLE (!!)"}`);
    if (uid) await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}

// BIDS — sensitive columns (ip_address/max_amount/device_hash) must NOT be
// readable by anon/authenticated via PostgREST. 0083 revokes them.
{
  const { error } = await freshAnon().from("bids").select("id, max_amount, ip_address").limit(1);
  P(!!error, `BIDS column lockdown: max_amount/ip_address blocked${error ? ` (${error.code ?? ""})` : " — READABLE (!!)"}`);
  const { error: okErr } = await freshAnon().from("bids").select("id, amount, bidder_id").limit(1);
  P(!okErr, `BIDS safe columns still readable${okErr ? ` — ${okErr.message}` : ""}`);
}

// B7 — a SELLER must NOT mutate their own auction row directly via PostgREST,
// bypassing the place_bid/close/tick state machine. 0099 drops the owner
// `FOR ALL` policy (it allowed UPDATE/DELETE), leaving owner INSERT + admin
// writes only. The exploit: a seller "awards" their own auction to themselves
// (or an accomplice) at a sham price. With RLS this UPDATE matches no policy
// and is a 0-row no-op, so we verify the row is UNCHANGED via service-role.
{
  const email = `sec-seller-${process.hrtime.bigint()}@example.com`;
  const password = "SecProbe!2026x";
  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) { P(false, `B7: probe seller create failed (${cErr.message})`); }
  else {
    const uid = created.user?.id;
    let propId, aucId;
    const { data: prop, error: pErr } = await svc.from("properties")
      .insert({ owner_id: uid, title: "SEC PROBE LOT", type: "apartment", governorate: "Tunis" })
      .select("id").single();
    if (pErr || !prop) { P(false, `B7: property seed failed (${pErr?.message ?? "no row"})`); }
    else {
      propId = prop.id;
      const nowMs = Date.now();
      const { data: auc, error: aErr } = await svc.from("auctions")
        .insert({
          property_id: propId, type: "english", opening_price: 1000, current_price: 1000, status: "live",
          starts_at: new Date(nowMs - 3_600_000).toISOString(),
          ends_at: new Date(nowMs + 3_600_000).toISOString(),
        })
        .select("id").single();
      if (aErr || !auc) { P(false, `B7: auction seed failed (${aErr?.message ?? "no row"})`); }
      else {
        aucId = auc.id;
        const authed = createClient(url, anonKey, { auth: { persistSession: false } });
        await authed.auth.signInWithPassword({ email, password });
        await authed.from("auctions").update({
          status: "ended_sold", winner_user_id: uid, winner_amount: 1, current_price: 999_999,
        }).eq("id", aucId);
        const { data: after } = await svc.from("auctions")
          .select("status, winner_user_id, current_price").eq("id", aucId).single();
        const unchanged = !!after && after.status === "live" && after.winner_user_id === null && Number(after.current_price) === 1000;
        P(unchanged, `B7 seller-hijack: direct UPDATE of own auction blocked (status=${after?.status}, winner=${after?.winner_user_id ? "SET(!!)" : "null"})`);
      }
    }
    if (aucId) await svc.from("auctions").delete().eq("id", aucId).then(() => {}, () => {});
    if (propId) await svc.from("properties").delete().eq("id", propId).then(() => {}, () => {});
    if (uid) await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}

// B8 — a logged-in user must NOT be able to INSERT a seller_payouts row
// directly via PostgREST (forging a 'requested' payout with an arbitrary amount
// bypasses request_payout's balance check). 0103 drops payouts_self_insert +
// revokes the INSERT grant; the only legit path is the request_payout RPC.
{
  const email = `sec-payout-${process.hrtime.bigint()}@example.com`;
  const password = "SecProbe!2026x";
  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) { P(false, `B8: probe user create failed (${cErr.message})`); }
  else {
    const uid = created.user?.id;
    const authed = createClient(url, anonKey, { auth: { persistSession: false } });
    await authed.auth.signInWithPassword({ email, password });
    const { error } = await authed.from("seller_payouts").insert({
      seller_id: uid, amount: 999999, status: "requested", iban: "TN5904018104004942712345",
    });
    P(!!error, `B8 forge-payout: direct seller_payouts INSERT blocked${error ? ` (${error.code ?? ""})` : " — ACCEPTED (!!)"}`);
    if (uid) await svc.auth.admin.deleteUser(uid).catch(() => {});
  }
}

console.log(`\n${fails === 0 ? "ALL SECURITY CHECKS PASSED" : `${fails} SECURITY CHECK(S) FAILED`}`);
process.exit(fails === 0 ? 0 : 1);
