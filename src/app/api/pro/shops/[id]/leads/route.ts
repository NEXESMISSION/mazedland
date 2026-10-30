import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { parseLeadPatch, parseNewLead } from "@/lib/pro/leads";
import { isUuid } from "@/lib/uuid";

/**
 * A shop's clients (0174). Every member follows them.
 *   POST   { name, phone?, listingId?, note?, stage?, next_action_at? }   add one by hand
 *   PATCH  { leadId, stage?, note?, next_action_at? }                     move one along
 *   DELETE { leadId }
 * An annonce named here must be the shop's own.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "clients" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const parsed = parseNewLead(await jsonObject(req));
  if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(`leadErrors.${parsed.error}`) }, { status: 400 });
  const value = parsed.value;
  if (value.listing_id) {
    const { data: own } = await admin.from("listings").select("id").eq("id", value.listing_id).eq("shop_id", id).maybeSingle();
    if (!own) value.listing_id = null;
  }
  const { data, error } = await admin
    .from("leads")
    .insert({ ...value, shop_id: id, source: "manual", created_by: user.id })
    .select("id")
    .single();
  if (error || !data) return fail("lead_create_failed", 500, error);
  logAction(req, user, "lead.create", { shop: id, id: data.id });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "clients" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const body = await jsonObject(req);
  const leadId = body.leadId;
  // Checked before Postgres sees it: a malformed id was a cast error turned 500.
  if (!isUuid(leadId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const patch = parseLeadPatch(body);
  if (!patch) return NextResponse.json({ error: "invalid", detail: t("leadErrors.patch") }, { status: 400 });
  const { data, error } = await admin.from("leads").update(patch).eq("id", leadId).eq("shop_id", id).select("id");
  if (error) return fail("lead_update_failed", 500, error);
  if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logAction(req, user, "lead.update", { shop: id, id: leadId, ...(patch.stage ? { stage: patch.stage } : {}) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "clients" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const body = (await jsonObject(req)) as { leadId?: unknown };
  const leadId = body.leadId;
  if (!isUuid(leadId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data, error } = await admin.from("leads").delete().eq("id", leadId).eq("shop_id", id).select("id");
  if (error) return fail("lead_delete_failed", 500, error);
  if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  logAction(req, user, "lead.delete", { shop: id, id: leadId });
  return NextResponse.json({ ok: true });
}
