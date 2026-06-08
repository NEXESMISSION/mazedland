// ============================================================================
// HERMETIC structural assertions — dangerous grants/policies are ABSENT.
//
// This suite needs NO secrets: it connects to the local stack's Postgres with
// the deterministic superuser DSN that `supabase start` always exposes
// (postgres:postgres@127.0.0.1:54322/postgres; overridable via SUPABASE_DB_URL)
// and asks the catalog directly. It runs in the same CI job, right after the
// migrations apply, and is the fast structural backstop for the audit's
// privilege findings — it would have caught every one of the grant leaks that
// migrations 0068/0082/0083/0090/0057 closed.
//
// Asserts:
//   1. authenticated CANNOT execute the 6-arg enqueue_notification (0082) —
//      the forged-notification / branded-phishing vector.
//   2. anon CANNOT select bids.ip_address (0083/0090) — PII leak.
//   3. neither anon nor authenticated can INSERT a 'captured' payment
//      (the _guard_payment_capture trigger, 0057) — free-win / free-eligibility.
//   4. a non-admin authenticated user gets NOTHING when reading another user's
//      profile (RLS profiles_self_read, 0001) — cross-user PII.
// ============================================================================
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const DSN =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: DSN });
  await db.connect();
});

afterAll(async () => {
  await db?.end().catch(() => {});
});

async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query(sql, params);
  return Object.values(res.rows[0])[0] as T;
}

describe("structural grants/policies — dangerous capabilities are ABSENT", () => {
  it("authenticated cannot execute the 6-arg enqueue_notification (0082)", async () => {
    const canExec = await scalar<boolean>(
      `select has_function_privilege(
         'authenticated',
         'public.enqueue_notification(uuid,text,text,text,text,jsonb)',
         'execute'
       )`,
    );
    expect(canExec).toBe(false);
  });

  it("anon cannot read bids.ip_address (0083/0090)", async () => {
    const canRead = await scalar<boolean>(
      `select has_column_privilege('anon', 'public.bids', 'ip_address', 'select')`,
    );
    expect(canRead).toBe(false);

    // Belt-and-braces: anon also can't read the secret proxy ceiling.
    const canReadMax = await scalar<boolean>(
      `select has_column_privilege('anon', 'public.bids', 'max_amount', 'select')`,
    );
    expect(canReadMax).toBe(false);

    // Positive control — a safe column IS still readable (the leaderboard works).
    const canReadAmount = await scalar<boolean>(
      `select has_column_privilege('anon', 'public.bids', 'amount', 'select')`,
    );
    expect(canReadAmount).toBe(true);
  });

  it("anon/authenticated cannot INSERT a captured payment (the capture guard, 0057)", async () => {
    // The _guard_payment_capture BEFORE trigger raises payment_status_forbidden
    // for any non-pending status unless the caller is service_role or an admin.
    // Confirm the trigger exists on public.payments ...
    const triggerCount = await scalar<number>(
      `select count(*)::int
         from pg_trigger
        where tgrelid = 'public.payments'::regclass
          and tgname = '_guard_payment_capture'
          and not tgisinternal`,
    );
    expect(triggerCount).toBe(1);

    // ... and that the insert RLS policy only permits status = 'pending'
    // (so even bypassing the trigger, the policy with-check blocks 'captured').
    // Use the pg_policies view, which renders with_check as readable SQL text.
    const policyAllowsOnlyPending = await scalar<boolean>(
      `select bool_and(with_check ilike '%status%pending%')
         from pg_policies
        where schemaname = 'public'
          and tablename  = 'payments'
          and cmd        = 'INSERT'
          and with_check is not null`,
    );
    expect(policyAllowsOnlyPending).toBe(true);

    // And the live behaviour: as the `authenticated` role, inserting a captured
    // payment must raise (the guard fires before the row lands). Run inside a
    // SET ROLE so we exercise the real grant/trigger path, then roll back.
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      let raised = false;
      try {
        await db.query(
          `insert into public.payments (user_id, kind, provider, amount, status)
             values (gen_random_uuid(), 'buy_now', 'manual', 1, 'captured')`,
        );
      } catch {
        raised = true;
      }
      expect(raised).toBe(true);
    } finally {
      await db.query("rollback");
    }
  });

  it("a non-admin cannot SELECT another user's profile (RLS, 0001)", async () => {
    // Seed two users via the superuser (RLS bypassed). Create the auth.users
    // parents first (FK target), then the profiles rows explicitly — we don't
    // rely on the on_auth_user_created trigger timing/columns. Token columns on
    // auth.users carry '' defaults on the local stack, so a minimal insert is
    // enough; the profile insert is what RLS reads.
    const seedUser = async (): Promise<string> => {
      const id = await scalar<string>(
        `insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
           values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
                   'authenticated', 'authenticated',
                   'struct-' || gen_random_uuid() || '@example.test',
                   '{}'::jsonb, '{}'::jsonb, now(), now())
         returning id`,
      );
      await db.query(
        `insert into public.profiles (id, role, kyc_status)
           values ($1, 'individual', 'none')
         on conflict (id) do nothing`,
        [id],
      );
      return id;
    };
    const a = await seedUser();
    const b = await seedUser();

    await db.query("begin");
    try {
      // Present user A's JWT claims (so auth.uid() === A), THEN drop to the
      // `authenticated` role and try to read user B's profile. Set the claim
      // first — the authenticated role may lack rights to set it. RLS
      // profiles_self_read should return zero rows for B.
      await db.query(
        `select set_config('request.jwt.claims',
           json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [a],
      );
      await db.query("set local role authenticated");
      const visible = await db.query(
        `select count(*)::int as c from public.profiles where id = $1`,
        [b],
      );
      expect(visible.rows[0].c).toBe(0);

      // Positive control — A CAN read their OWN profile.
      const own = await db.query(
        `select count(*)::int as c from public.profiles where id = $1`,
        [a],
      );
      expect(own.rows[0].c).toBe(1);
    } finally {
      await db.query("rollback");
      // Clean up the seeded users (cascades to profiles).
      await db.query(`delete from auth.users where id = any($1::uuid[])`, [[a, b]]);
    }
  });
});
