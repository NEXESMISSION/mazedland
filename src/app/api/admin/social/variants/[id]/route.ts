import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { hasContactInText } from "@/lib/moderation/rules";

/**
 * PATCH /api/admin/social/variants/:id  { body }
 *
 * An admin corrects a post's text before approving it. Only while the
 * request waits for review — what was approved is what gets posted — and
 * never with a phone number or an e-mail in it. The reference (« MZ-… »)
 * must stay: it is how the engine recognises the post after a timeout.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const { id } = await params;
  const t = await apiTranslator(req, "adminSocial.errors");
  const payload = (await req.json().catch(() => ({}))) as { body?: unknown };
  const body = typeof payload.body === "string" ? payload.body.replace(/\r\n/g, "\n").trim() : "";
  if (body.length < 10 || body.length > 2200) return NextResponse.json({ error: "invalid", detail: t("length") }, { status: 400 });

  const { data: v } = await admin
    .from("social_content_variants")
    .select("id, request:social_publication_requests (status, ref)")
    .eq("id", id)
    .maybeSingle();
  const request = (Array.isArray(v?.request) ? v?.request[0] : v?.request) as { status: string; ref: string } | undefined;
  if (!v || !request) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (request.status !== "pending_approval") return NextResponse.json({ error: "conflict" }, { status: 409 });
  if (!body.includes(`MZ-${request.ref}`)) return NextResponse.json({ error: "invalid", detail: t("reference") }, { status: 400 });
  // The post's own links are allowed (the annonce, the /p/ short link); a
  // phone number or an e-mail is not.
  if (hasContactInText(body.replace(/https?:\/\/\S+/g, "").replace(/\S+\/p\/[0-9a-f]{6}\b/gi, ""))) {
    return NextResponse.json({ error: "invalid", detail: t("contact") }, { status: 400 });
  }

  const { error } = await admin
    .from("social_content_variants")
    .update({ body, edited_by: gate.user.id, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return fail("variant_update_failed", 500, error);
  logAction(req, gate.user, "social.variant_edit", { id });
  return NextResponse.json({ ok: true });
}
