import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import type { PropertyType, AttributeDataType } from "@/lib/types";

const PROPERTY_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

const DATA_TYPES: AttributeDataType[] = ["number", "text", "boolean", "select"];

type IncomingOption = { value?: unknown; label?: unknown };
type IncomingItem = {
  id?: string;
  field_key?: string;
  label?: unknown;
  data_type?: unknown;
  options?: unknown;
  unit?: unknown;
  required?: unknown;
  sort_order?: unknown;
};

type CleanItem = {
  id?: string;
  label: string;
  data_type: AttributeDataType;
  options: { value: string; label: string }[] | null;
  unit: string | null;
  required: boolean;
  sort_order: number;
};

/**
 * Turn a French label into a stable, snake_case storage key. Drops
 * accents, lowercases, replaces runs of non-alphanumerics with "_", and
 * guarantees it starts with a letter (the column CHECK requires it). This
 * is only ever computed for NEW rows — existing rows keep their key so
 * already-stored attribute values never orphan.
 */
function slugifyKey(label: string): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  if (!base) return "field";
  return /^[a-z]/.test(base) ? base : `f_${base}`.slice(0, 40);
}

/**
 * PUT /api/admin/characteristics — replace the characteristics catalog for
 * ONE property type. Body: { property_type, items: [...] }. Mirrors the
 * legal-docs route: diff server-side (delete missing, update by id, insert
 * the rest) so the editor needs a single round-trip.
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
  if (rawItems.length > 30) {
    return NextResponse.json({ error: "too_many_items" }, { status: 400 });
  }

  const seenLabels = new Set<string>();
  const cleaned: CleanItem[] = [];

  for (const [i, raw] of (rawItems as IncomingItem[]).entries()) {
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ error: "invalid_item", index: i }, { status: 400 });
    }
    const label = typeof raw.label === "string" ? raw.label.trim() : "";
    if (!label || label.length > 60) {
      return NextResponse.json({ error: "invalid_label", index: i }, { status: 400 });
    }
    if (seenLabels.has(label.toLowerCase())) {
      return NextResponse.json({ error: "duplicate_label", index: i, label }, { status: 400 });
    }
    seenLabels.add(label.toLowerCase());

    const data_type = DATA_TYPES.includes(raw.data_type as AttributeDataType)
      ? (raw.data_type as AttributeDataType)
      : "number";

    let options: { value: string; label: string }[] | null = null;
    if (data_type === "select") {
      if (!Array.isArray(raw.options) || raw.options.length === 0) {
        return NextResponse.json({ error: "options_required", index: i }, { status: 400 });
      }
      const seenVals = new Set<string>();
      options = [];
      for (const o of raw.options as IncomingOption[]) {
        const value = typeof o?.value === "string" ? o.value.trim() : "";
        const oLabel = typeof o?.label === "string" ? o.label.trim() : "";
        if (!value || value.length > 40 || !oLabel || oLabel.length > 60) {
          return NextResponse.json({ error: "invalid_option", index: i }, { status: 400 });
        }
        if (seenVals.has(value)) {
          return NextResponse.json({ error: "duplicate_option", index: i, value }, { status: 400 });
        }
        seenVals.add(value);
        options.push({ value, label: oLabel });
      }
    }

    const unit =
      typeof raw.unit === "string" && raw.unit.trim().length > 0
        ? raw.unit.trim().slice(0, 12)
        : null;
    const required = raw.required === true;
    const sort_order = Number.isFinite(raw.sort_order) ? Number(raw.sort_order) : i * 10;

    cleaned.push({
      id: typeof raw.id === "string" ? raw.id : undefined,
      label,
      data_type,
      options,
      unit,
      required,
      sort_order,
    });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // 1. Existing rows for this type → compute deletes and keep field_keys
  //    stable for updates.
  const { data: existing, error: exErr } = await admin
    .from("property_attribute_kinds")
    .select("id, field_key")
    .eq("property_type", propertyType);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });

  const existingById = new Map(
    (existing ?? []).map((r) => [r.id as string, r.field_key as string]),
  );
  const keepIds = new Set(cleaned.map((c) => c.id).filter(Boolean) as string[]);
  const toDelete = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !keepIds.has(id));

  if (toDelete.length > 0) {
    const { error: dErr } = await admin
      .from("property_attribute_kinds")
      .delete()
      .in("id", toDelete);
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  }

  // 2. Updates (keep field_key) + inserts (derive a unique field_key).
  const updates = cleaned.filter((c) => c.id && existingById.has(c.id));
  const inserts = cleaned.filter((c) => !c.id || !existingById.has(c.id));

  for (const u of updates) {
    const { error: uErr } = await admin
      .from("property_attribute_kinds")
      .update({
        label: u.label,
        data_type: u.data_type,
        options: u.options,
        unit: u.unit,
        required: u.required,
        sort_order: u.sort_order,
      })
      .eq("id", u.id!)
      .eq("property_type", propertyType);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  }

  if (inserts.length > 0) {
    // Field keys must be unique within the type. Seed the taken set with
    // the keys we're keeping, then derive + de-dupe for each new row.
    const taken = new Set<string>();
    for (const id of keepIds) {
      const fk = existingById.get(id);
      if (fk) taken.add(fk);
    }
    const rows = inserts.map((ins) => {
      let key = slugifyKey(ins.label);
      if (taken.has(key)) {
        let n = 2;
        while (taken.has(`${key}_${n}`.slice(0, 40))) n++;
        key = `${key}_${n}`.slice(0, 40);
      }
      taken.add(key);
      return {
        property_type: propertyType,
        field_key: key,
        label: ins.label,
        data_type: ins.data_type,
        options: ins.options,
        unit: ins.unit,
        required: ins.required,
        sort_order: ins.sort_order,
      };
    });
    const { error: iErr } = await admin
      .from("property_attribute_kinds")
      .insert(rows);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    deleted: toDelete.length,
    updated: updates.length,
    inserted: inserts.length,
  });
}
