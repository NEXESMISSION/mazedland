// ============================================================================
// Security regression gate — re-runs the attacks this platform has actually
// been exposed to, against the configured Supabase project, and FAILS (exit 1)
// if any of them works.
//
// It used to probe the auction schema: forge a caution, raise a bid, request a
// payout — against tables dropped with the auction product. Every one of those
// probes then "passed" because the table was gone. A security gate going green
// for a reason that has nothing to do with security is worse than no gate, so
// a probe that hits a missing table now FAILS as stale instead.
//
// DEFAULT MODE IS READ-ONLY and safe against production:
//   · anonymous PostgREST reads that must return nothing sensitive
//   · catalog checks, inside a READ ONLY transaction, that service-only
//     functions, TRUNCATE and the contact-number columns are not granted to
//     the client roles (needs SB_HOST / SB_REF / SB_DB_PASSWORD)
//
// --write adds probes that CREATE a throwaway user and delete it afterwards.
// Run those against staging, never against a database with real users:
//   · signup cannot self-assign the admin role
//   · a signed-in user cannot read seller phone numbers
//   · a signed-in user cannot edit somebody else's annonce
//   · a signed-in user cannot record a payment as already captured
//
//   node scripts/security-regression.mjs           read-only
//   node scripts/security-regression.mjs --write   + write probes (staging)
// ============================================================================

import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !svcKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const WRITE = process.argv.includes("--write");
const svc = createClient(url, svcKey, { auth: { persistSession: false } });
const freshAnon = () => createClient(url, anonKey, { auth: { persistSession: false } });

let passed = 0;
let failed = 0;
const P = (ok, label) => {
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"} — ${label}`);
  if (ok) passed++;
  else failed++;
};

// PostgREST / Postgres codes for "that relation does not exist".
const MISSING_RELATION = new Set(["42P01", "PGRST205", "PGRST200"]);

// Keep in sync with supabase/migrations/0157_privilege_hardening.sql.
const SERVICE_ONLY_FUNCTIONS = [
  "public._is_banned(uuid)",
  "public._notify_admins(text, text, text, text)",
  "public.check_auth_ratelimit(text)",
  "public.check_rate_limit(text, integer, integer)",
  "public.claim_emailable_notifications(integer, text[], timestamp with time zone, integer)",
  "public.claim_smsable_notifications(integer, text[], timestamp with time zone, integer)",
  "public.cleanup_old_notifications()",
  "public.cleanup_phone_otps()",
  "public.enqueue_waitlist(text, text, text, inet)",
  "public.final_payment_interval()",
  "public.notify_kyc_pending_reminder()",
  "public.prune_activity_log()",
  "public.prune_read_notifications()",
  "public.record_listing_view(uuid, text, uuid)",
  "public.stamp_cron_heartbeat(text, integer)",
  "public.update_inspection_status(uuid, public.inspection_status, text)",
];

console.log(`Security regression gate — ${new URL(url).host} — ${WRITE ? "READ + WRITE probes" : "read-only"}\n`);

// ── Anonymous reads ─────────────────────────────────────────────────────────
{
  const { data, error } = await freshAnon()
    .from("listings")
    .select("id, contact_phone, contact_whatsapp")
    .eq("status", "published")
    .limit(50);
  const leaked = error ? 0 : (data ?? []).filter((r) => r.contact_phone || r.contact_whatsapp).length;
  P(!!error || leaked === 0, `anon cannot read seller phone numbers${error ? "" : ` (${leaked} exposed)`}`);
}

{
  const { data, error } = await freshAnon().from("profiles").select("id, phone").not("phone", "is", null).limit(5);
  P(!!error || (data ?? []).length === 0, "anon cannot read profiles.phone");
}

for (const table of [
  "payments", "notifications", "contact_reveals", "activity_log", "rate_limits",
  "phone_otps", "auth_attempts", "listing_views", "seller_credits", "credit_ledger",
  "watchlist", "popup_views",
]) {
  const { data, error } = await freshAnon().from(table).select("*").limit(1);
  if (error && MISSING_RELATION.has(error.code)) {
    P(false, `probe is stale — table ${table} does not exist; update this gate`);
  } else {
    P(!!error || (data ?? []).length === 0, `anon sees no rows in ${table}`);
  }
}

for (const bucket of ["receipts", "property-documents", "kyc"]) {
  const { data, error } = await freshAnon().storage.from(bucket).list("", { limit: 1 });
  P(!!error || (data ?? []).length === 0, `anon cannot list the private "${bucket}" bucket`);
}

{
  const { data, error } = await freshAnon()
    .from("listings")
    .select("id, title, price")
    .eq("status", "published")
    .limit(1);
  P(!error && Array.isArray(data), "positive control: anon can still read the public catalogue columns");
}

// ── Catalog (read-only transaction) ─────────────────────────────────────────
if (process.env.SB_HOST && process.env.SB_REF && process.env.SB_DB_PASSWORD) {
  let client = null;
  for (const port of [5432, 6543]) {
    const c = new pg.Client({
      host: process.env.SB_HOST,
      port,
      user: `postgres.${process.env.SB_REF}`,
      password: process.env.SB_DB_PASSWORD,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    });
    try {
      await c.connect();
      client = c;
      break;
    } catch {
      /* try the next port */
    }
  }

  if (!client) {
    P(false, "could not connect to the database for the catalog checks");
  } else {
    try {
      await client.query("begin transaction read only");

      const { rows } = await client.query(
        `select fn,
                to_regprocedure(fn) is not null as present,
                coalesce(has_function_privilege('anon', to_regprocedure(fn), 'EXECUTE'), false) as anon,
                coalesce(has_function_privilege('authenticated', to_regprocedure(fn), 'EXECUTE'), false) as auth
           from unnest($1::text[]) as fn`,
        [SERVICE_ONLY_FUNCTIONS],
      );
      for (const r of rows) {
        if (!r.present) {
          // Dropping a function is strictly safer than restricting it.
          console.log(`   · ${r.fn} no longer exists — nothing to restrict`);
          continue;
        }
        P(!r.anon && !r.auth, `${r.fn} is not callable by client roles`);
      }

      const { rows: cols } = await client.query(
        `select has_column_privilege('anon', 'public.listings', 'contact_phone', 'SELECT') as anon_phone,
                has_column_privilege('authenticated', 'public.listings', 'contact_phone', 'SELECT') as auth_phone,
                has_column_privilege('anon', 'public.listings', 'contact_whatsapp', 'SELECT') as anon_wa,
                has_column_privilege('authenticated', 'public.listings', 'contact_whatsapp', 'SELECT') as auth_wa`,
      );
      const c0 = cols[0];
      P(
        !c0.anon_phone && !c0.auth_phone && !c0.anon_wa && !c0.auth_wa,
        "client roles hold no SELECT on listings.contact_phone / contact_whatsapp",
      );

      const { rows: truncate } = await client.query(
        `select count(*)::int as n
           from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
          where ns.nspname = 'public' and cl.relkind = 'r'
            and (has_table_privilege('anon', cl.oid, 'TRUNCATE')
                 or has_table_privilege('authenticated', cl.oid, 'TRUNCATE'))`,
      );
      P(truncate[0].n === 0, `client roles hold no TRUNCATE on public tables (${truncate[0].n} found)`);

      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
} else {
  console.log("⚠️  SKIP — catalog checks need SB_HOST / SB_REF / SB_DB_PASSWORD");
}

// ── Write probes (staging only) ─────────────────────────────────────────────
if (WRITE) {
  console.log("\n— write probes: a throwaway user is created and deleted —");
  const stamp = Date.now();
  const password = `SecProbe!${stamp}x`;

  // Signup must not be able to self-assign the admin role.
  {
    const email = `sec-escalation-${stamp}@example.com`;
    const { data: su, error } = await freshAnon().auth.signUp({
      email,
      password,
      options: { data: { role: "admin", full_name: "SEC PROBE" } },
    });
    if (error) {
      P(true, `signup cannot self-assign admin (signUp rejected: ${error.message})`);
    } else {
      const uid = su.user?.id;
      const { data: prof } = await svc.from("profiles").select("role").eq("id", uid).maybeSingle();
      const { data: au } = await svc.auth.admin.getUserById(uid);
      P(
        prof?.role !== "admin" && au?.user?.app_metadata?.role !== "admin",
        `signup cannot self-assign admin (profile role=${prof?.role ?? "none"})`,
      );
      if (uid) await svc.auth.admin.deleteUser(uid).catch(() => {});
    }
  }

  const email = `sec-probe-${stamp}@example.com`;
  const { data: created, error: createError } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "SEC PROBE" },
  });

  if (createError) {
    P(false, `could not create the probe user: ${createError.message}`);
  } else {
    const uid = created.user.id;
    try {
      const authed = freshAnon();
      const { error: signInError } = await authed.auth.signInWithPassword({ email, password });
      if (signInError) {
        P(false, `probe user could not sign in: ${signInError.message}`);
      } else {
        {
          const { data, error } = await authed
            .from("listings")
            .select("id, contact_phone")
            .eq("status", "published")
            .limit(20);
          const leaked = error ? 0 : (data ?? []).filter((r) => r.contact_phone).length;
          P(!!error || leaked === 0, "a signed-in user cannot read seller phone numbers");
        }

        {
          const { data: victim } = await svc
            .from("listings")
            .select("id, title")
            .eq("status", "published")
            .neq("seller_id", uid)
            .limit(1)
            .maybeSingle();
          if (victim) {
            await authed.from("listings").update({ title: "SEC PROBE — must not stick" }).eq("id", victim.id);
            const { data: after } = await svc.from("listings").select("title").eq("id", victim.id).single();
            const changed = after?.title !== victim.title;
            if (changed) await svc.from("listings").update({ title: victim.title }).eq("id", victim.id);
            P(!changed, "a signed-in user cannot edit somebody else's annonce");
          } else {
            console.log("⚠️  SKIP — no published annonce by another seller to probe");
          }
        }

        {
          const { data: pay, error } = await authed
            .from("payments")
            .insert({ user_id: uid, kind: "listing_fee", provider: "bank_transfer", amount: 1, status: "captured" })
            .select("id")
            .maybeSingle();
          if (!error && pay?.id) await svc.from("payments").delete().eq("id", pay.id);
          P(!!error || !pay, "a signed-in user cannot record a payment as already captured");
        }
      }
    } finally {
      await svc.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
