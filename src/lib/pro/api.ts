import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";
import { can, roleIn, type ShopAction, type ShopRole } from "./shops";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * The door every /api/pro route goes through: same origin, signed in, the
 * service client — and, given a shop and an action, the caller's role in that
 * shop allowing it. Returns the response to send on any failure.
 */
export async function proGate(
  req: NextRequest,
  shop?: { id: string; action: ShopAction },
): Promise<{ user: User; admin: Admin; role: ShopRole | null } | NextResponse> {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  if (!shop) return { user, admin, role: null };
  if (!/^[0-9a-f-]{36}$/i.test(shop.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const role = await roleIn(admin, shop.id, user.id);
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(role, shop.action)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { user, admin, role };
}
