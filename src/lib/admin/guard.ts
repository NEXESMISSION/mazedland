import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { canOpen, scopesFromRow, type AdminScopes, type ConsoleSection } from "./sections";

export type AdminContext = {
  user: User;
  supabase: Awaited<ReturnType<typeof getServerSupabase>>;
  /** `null` = the whole console (src/lib/admin/sections.ts). */
  scopes: AdminScopes;
};

/**
 * Shared admin-route guard. This 12-line block used to be copy-pasted at the
 * top of every `/api/admin/*` route — which meant the platform's entire admin
 * authorization surface lived in ~16 places, and tightening it (or fixing a
 * hole) meant editing all of them. Now it lives here, once.
 *
 * Returns a `NextResponse` to short-circuit on any failure
 * (cross-origin → 403, unauthenticated → 401, non-admin → 403), or the
 * authenticated admin context `{ user, supabase }` on success.
 *
 * Usage:
 *   const gate = await requireAdmin(req);
 *   if (gate instanceof NextResponse) return gate;
 *   const { user, supabase } = gate;
 *
 * The error shapes are kept byte-for-byte identical to the old inline block so
 * existing client error handling keeps working unchanged.
 *
 * `section` names the screen the route serves (src/lib/admin/sections.ts); a
 * team member without it gets 403 `forbidden_section`. A route whose actions
 * belong to different sections checks the rest itself with `canOpen`.
 */
export async function requireAdmin(
  req: NextRequest,
  section?: ConsoleSection,
): Promise<AdminContext | NextResponse> {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, admin_scopes, banned_at")
    .eq("id", user.id)
    .single();
  // A suspended member (banned_at) is a non-admin until reinstated.
  if (profile?.role !== "admin" || profile.banned_at) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scopes = scopesFromRow(profile.admin_scopes);
  if (!canOpen(scopes, section)) {
    return NextResponse.json({ error: "forbidden_section", section }, { status: 403 });
  }

  return { user, supabase, scopes };
}
