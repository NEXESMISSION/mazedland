import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

export type AdminContext = {
  user: User;
  supabase: Awaited<ReturnType<typeof getServerSupabase>>;
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
 */
export async function requireAdmin(
  req: NextRequest,
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
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  return { user, supabase };
}
