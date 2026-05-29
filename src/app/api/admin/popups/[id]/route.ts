import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { sanitizePopupBody } from "../route";

/**
 * Admin popup detail endpoints.
 *
 * GET    /api/admin/popups/[id]   → fetch one (for the edit form)
 * PATCH  /api/admin/popups/[id]   → update (full replacement except slug)
 * DELETE /api/admin/popups/[id]   → hard delete; popup_views cascades
 */

async function requireAdmin() {
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "auth", status: 401 as const, supabase: null };
  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: "forbidden", status: 403 as const, supabase: null };
  }
  return { error: null, status: 200 as const, supabase };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const g = await requireAdmin();
  if (!g.supabase) return NextResponse.json({ error: g.error }, { status: g.status });

  const { data, error } = await g.supabase
    .from("popups").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ item: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await params;
  const g = await requireAdmin();
  if (!g.supabase) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const payload = sanitizePopupBody(body);
  if (typeof payload === "string") {
    return NextResponse.json({ error: payload }, { status: 400 });
  }

  const { data, error } = await g.supabase
    .from("popups")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const { id } = await params;
  const g = await requireAdmin();
  if (!g.supabase) return NextResponse.json({ error: g.error }, { status: g.status });

  const { error } = await g.supabase.from("popups").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
