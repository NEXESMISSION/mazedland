import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/uuid";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { sanitizePopupBody } from "../route";

/**
 * Admin popup detail endpoints.
 *
 * GET    /api/admin/popups/[id]   → fetch one (for the edit form)
 * PATCH  /api/admin/popups/[id]   → update (full replacement except slug)
 * DELETE /api/admin/popups/[id]   → hard delete; popup_views cascades
 *
 * All three go through the shared guard (src/lib/admin/guard.ts), which
 * refuses a suspended member — the local copy this route kept did not look
 * at `banned_at`.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await requireAdmin(req, "popups");
  if (gate instanceof NextResponse) return gate;
  if (!isUuid(id)) return NextResponse.json({ error: "popup_not_found" }, { status: 404 });

  const { data, error } = await gate.supabase
    .from("popups").select("*").eq("id", id).single();
  if (error) return fail("popup_not_found", 404, error);
  return NextResponse.json({ item: data });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await requireAdmin(req, "popups");
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  if (!isUuid(id)) return NextResponse.json({ error: "popup_not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const payload = sanitizePopupBody(body);
  if (typeof payload === "string") {
    return NextResponse.json({ error: payload }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("popups")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    // PGRST116: no such popup; 23505: the slug is taken by another one.
    if (error.code === "PGRST116") return NextResponse.json({ error: "popup_not_found" }, { status: 404 });
    if (error.code === "23505") return NextResponse.json({ error: "slug_taken" }, { status: 409 });
    return fail("popup_update_failed", 500, error);
  }
  logAction(req, user, "popup.update", { popupId: id });
  return NextResponse.json({ item: data });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const gate = await requireAdmin(req, "popups");
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  if (!isUuid(id)) return NextResponse.json({ error: "popup_not_found" }, { status: 404 });

  const { error } = await supabase.from("popups").delete().eq("id", id);
  if (error) return fail("popup_delete_failed", 500, error);
  logAction(req, user, "popup.delete", { popupId: id });
  return NextResponse.json({ ok: true });
}
