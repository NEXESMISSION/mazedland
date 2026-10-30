import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";
import { isUuid } from "@/lib/uuid";
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
  if (!isUuid(shop.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const role = await roleIn(admin, shop.id, user.id);
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(role, shop.action)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { user, admin, role };
}

export type ProjectRow = { id: string; shop_id: string; slug: string; name: string; status: string };

/**
 * The door of the /api/pro/projects routes: proGate, then the project, and
 * the caller's right to manage the projects of its agence. A project of an
 * agence they are not in is « not found », as for shops.
 */
export async function projectGate(
  req: NextRequest,
  projectId: string,
): Promise<{ user: User; admin: Admin; role: ShopRole; project: ProjectRow } | NextResponse> {
  const base = await proGate(req);
  if (base instanceof NextResponse) return base;
  if (!isUuid(projectId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: project } = await base.admin
    .from("projects")
    .select("id, shop_id, slug, name, status")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const role = await roleIn(base.admin, project.shop_id as string, base.user.id);
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!can(role, "projects")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { user: base.user, admin: base.admin, role, project: project as ProjectRow };
}
