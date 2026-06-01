import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";
import type { PropertyType } from "@/lib/types";

const PROPERTY_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

type IncomingItem = {
  id?: string;
  label: string;
  description?: string | null;
  required?: boolean;
  sort_order?: number;
};

/**
 * PUT /api/admin/legal-docs — replace the legal-doc catalog for ONE property
 * type. Body: { property_type, items: [{id?, label, description, required, sort_order}] }.
 *
 * The route is the only writer the admin editor uses. We diff server-side:
 * any existing row whose id isn't in the incoming list gets deleted, the
 * rest are upserted. Doing it in one route means the editor doesn't need
 * three round-trips for create/update/delete.
 */
export async function PUT(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const propertyType = body.property_type as PropertyType | undefined;
  const rawItems = body.items;

  if (!propertyType || !PROPERTY_TYPES.includes(propertyType)) {
    return NextResponse.json({ error: "invalid_property_type" }, { status: 400 });
  }
  if (!Array.isArray(rawItems)) {
    return NextResponse.json({ error: "invalid_items" }, { status: 400 });
  }
  if (rawItems.length > 20) {
    return NextResponse.json({ error: "too_many_items" }, { status: 400 });
  }

  const seenLabels = new Set<string>();
  const cleaned: {
    id?: string;
    label: string;
    description: string | null;
    required: boolean;
    sort_order: number;
  }[] = [];

  for (const [i, raw] of (rawItems as IncomingItem[]).entries()) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "invalid_item", index: i }, { status: 400 });
    }
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label || label.length > 80) {
      return NextResponse.json({ error: "invalid_label", index: i }, { status: 400 });
    }
    if (seenLabels.has(label.toLowerCase())) {
      return NextResponse.json({ error: "duplicate_label", index: i, label }, { status: 400 });
    }
    seenLabels.add(label.toLowerCase());

    const description =
      typeof raw.description === "string" && raw.description.trim().length > 0
        ? raw.description.trim().slice(0, 240)
        : null;
    const required = raw.required === true;
    const sort_order = Number.isFinite(raw.sort_order) ? Number(raw.sort_order) : i * 10;

    cleaned.push({
      id: typeof raw.id === "string" ? raw.id : undefined,
      label,
      description,
      required,
      sort_order,
    });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // 1. Fetch existing rows for this property type so we can compute which
  //    ones to delete.
  const { data: existing, error: exErr } = await admin
    .from("legal_doc_kinds")
    .select("id")
    .eq("property_type", propertyType);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

  const keepIds = new Set(cleaned.map((c) => c.id).filter(Boolean) as string[]);
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    const { error: dErr } = await admin
      .from("legal_doc_kinds")
      .delete()
      .in("id", toDelete);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  }

  // 2. Upsert: rows with an id update, rows without an id insert.
  const updates = cleaned.filter((c) => c.id) as Array<typeof cleaned[number] & { id: string }>;
  const inserts = cleaned.filter((c) => !c.id);

  if (updates.length > 0) {
    for (const u of updates) {
      const { error: uErr } = await admin
        .from("legal_doc_kinds")
        .update({
          label: u.label,
          description: u.description,
          required: u.required,
          sort_order: u.sort_order,
        })
        .eq("id", u.id)
        .eq("property_type", propertyType);
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
    }
  }
  if (inserts.length > 0) {
    const { error: iErr } = await admin
      .from("legal_doc_kinds")
      .insert(
        inserts.map((i) => ({
          property_type: propertyType,
          label: i.label,
          description: i.description,
          required: i.required,
          sort_order: i.sort_order,
        })),
      );
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  logAction(req, user, "legal_docs.update", {
    propertyType,
    deleted: toDelete.length,
    updated: updates.length,
    inserted: inserts.length,
  });
  return NextResponse.json({
    ok: true,
    deleted: toDelete.length,
    updated: updates.length,
    inserted: inserts.length,
  });
}
