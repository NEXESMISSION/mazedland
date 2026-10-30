import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import { log } from "@/lib/log";

const dLog = log.scope("acc-del");

/**
 * POST /api/account/delete — user-initiated account deletion (GDPR erasure).
 *
 * Flow:
 *   1. request_account_deletion() RPC (runs as the user) guards against
 *      money-in-flight and, if clear, scrubs profile + KYC PII and tombstones
 *      the profile. Returns the private KYC storage paths to purge.
 *   2. We purge those KYC objects + anonymise & ban the auth user (so the
 *      email/phone PII is gone from auth.users and the login is disabled).
 *   3. Sign the user out.
 *
 * Returns 409 { blockers } when deletion is refused (active listing, unpaid
 * win, pending payment/payout) so the UI can explain what to settle first.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Irreversible PII scrub + permanent ban — must be same-origin (CSRF).
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // 1) Guard + scrub (atomic, runs as the user via auth.uid()).
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) {
    dLog.error(`rpc failed for ${user.id}: ${error.message}`);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    blockers?: string[];
    kyc_paths?: string[];
    already?: boolean;
  };

  if (result.ok === false) {
    return NextResponse.json(
      { error: "blocked", blockers: result.blockers ?? [] },
      { status: 409 },
    );
  }

  // 2) Best-effort purge of private KYC objects + anonymise/ban the auth user.
  const admin = getServiceSupabase();
  if (admin) {
    const paths = (result.kyc_paths ?? []).filter(Boolean);
    if (paths.length > 0) {
      const { error: rmErr } = await admin.storage.from("kyc").remove(paths);
      if (rmErr) dLog.warn(`kyc purge partial for ${user.id}: ${rmErr.message}`);
    }
    // Anonymise auth PII + permanently ban so the login is dead and no email
    // / phone remains in auth.users. ~100-year ban. GoTrue MERGES
    // user_metadata, so `{}` erased nothing and the name, phone and
    // governorate written at signup stayed: every key is set to null instead.
    const { data: before } = await admin.auth.admin.getUserById(user.id);
    const wipe = Object.fromEntries(Object.keys(before?.user?.user_metadata ?? {}).map((k) => [k, null]));
    const { error: authErr } = await admin.auth.admin.updateUserById(user.id, {
      email: `deleted+${user.id}@deleted.invalid`,
      phone: "",
      user_metadata: wipe,
      ban_duration: "876000h",
    });
    if (authErr) dLog.warn(`auth anonymise failed for ${user.id}: ${authErr.message}`);
    // The consents (0182) go with the account: the profile is tombstoned, not
    // deleted, so its cascade does not run.
    const { error: cErr } = await admin.from("user_consents").delete().eq("user_id", user.id);
    if (cErr) dLog.warn(`consents purge failed for ${user.id}: ${cErr.message}`);
  } else {
    dLog.warn("service client unavailable — auth PII not anonymised");
  }

  logAction(req, { id: user.id, email: user.email }, "account.deleted", {
    already: result.already === true,
  });

  // 3) Drop the session.
  await supabase.auth.signOut();

  // Surface the idempotency signal so a duplicate delete (e.g. a left-open tab
  // re-submitting) is distinguishable from a fresh erasure instead of looking
  // identical to the client.
  return NextResponse.json({ ok: true, already: result.already === true });
}
