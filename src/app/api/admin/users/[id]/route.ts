import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";

/**
 * Admin user management — change a user's ROLE (incl. promoting to admin) and
 * KYC status from the /admin/users directory.
 *
 * - Gated by requireAdmin (profiles.role='admin').
 * - profiles.* writes go through SECURITY DEFINER RPCs (0144) that open the
 *   _guard_profile_self_update bypass via the SERVICE-ROLE client, so they
 *   work regardless of the acting admin's JWT claim.
 * - Promoting/demoting ALSO sets the auth app_metadata.role claim, since
 *   is_admin() (RLS / DB guards) reads the JWT — it takes effect on the
 *   target's next token refresh / login.
 */

const ROLES = ["individual", "agency", "bank", "bailiff", "inspector", "admin"] as const;
const KYC = ["none", "submitted", "pending", "verified", "rejected"] as const;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;
  const { id } = await ctx.params;

  const body = (await req.json().catch(() => ({}))) as {
    role?: string;
    kyc_status?: string;
  };
  const role = body.role;
  const kyc = body.kyc_status;

  if (role === undefined && kyc === undefined) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }
  if (role !== undefined && !ROLES.includes(role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "bad_role" }, { status: 400 });
  }
  if (kyc !== undefined && !KYC.includes(kyc as (typeof KYC)[number])) {
    return NextResponse.json({ error: "bad_kyc" }, { status: 400 });
  }
  // Self-lockout guard: an admin can't strip their OWN admin role.
  if (role !== undefined && id === user.id && role !== "admin") {
    return NextResponse.json(
      { error: "self_demote_blocked", detail: "Vous ne pouvez pas retirer votre propre accès admin." },
      { status: 409 },
    );
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  if (role !== undefined) {
    const { error } = await admin.rpc("admin_set_user_role", { p_user_id: id, p_role: role });
    if (error) return fail("set_role_failed", 500, error);
    // Keep the JWT admin claim in sync with the profile role (is_admin() reads
    // the JWT). Applies on the target's next token refresh / login.
    const { error: authErr } = await admin.auth.admin.updateUserById(id, {
      app_metadata: { role },
    });
    if (authErr) return fail("set_role_auth_failed", 500, authErr);
  }

  if (kyc !== undefined) {
    const { error } = await admin.rpc("admin_set_kyc_status", { p_user_id: id, p_status: kyc });
    if (error) return fail("set_kyc_failed", 500, error);
  }

  logAction(req, user, "user.admin_update", { targetId: id, role, kyc });
  return NextResponse.json({ ok: true });
}
