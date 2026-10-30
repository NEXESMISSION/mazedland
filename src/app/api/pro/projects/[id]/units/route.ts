import { NextRequest, NextResponse } from "next/server";
import { projectGate } from "@/lib/pro/api";
import { parseUnitPatch, parseUnitPlan, planUnits, unitPlanSize } from "@/lib/pro/projects";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { isUuid } from "@/lib/uuid";

/**
 * The units of a project (0179).
 *
 *   POST   { mode: "floors" | "lots", … }      → make them (parseUnitPlan); a
 *          reference already in the project is skipped, not doubled.
 *   PATCH  { unitIds, status? price? area_sqm? rooms? } → change one or several.
 *   DELETE { unitIds }                         → remove them.
 */

// Real uuids only: 36 hyphens passed the old check and were a 500 in Postgres.
const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.length <= 500 && v.every((x) => isUuid(x)) ? (v as string[]) : null;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_projects");
  if (off) return off;
  const { id } = await params;
  const gate = await projectGate(req, id);
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi.projects");

  const plan = parseUnitPlan((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (!plan) return NextResponse.json({ error: "invalid", detail: t("badPlan") }, { status: 400 });

  const [{ data: last }, { count: existing }, settings] = await Promise.all([
    admin.from("project_units").select("sort_order").eq("project_id", id).order("sort_order", { ascending: false }).limit(1).maybeSingle(),
    admin.from("project_units").select("id", { count: "exact", head: true }).eq("project_id", id),
    getSettings(),
  ]);
  const max = settings.projects_max_units;
  if ((existing ?? 0) + unitPlanSize(plan) > max) {
    return NextResponse.json({ error: "too_many", detail: t("tooMany", { max }) }, { status: 400 });
  }

  const drafts = planUnits(plan, ((last?.sort_order as number | undefined) ?? -1) + 1).map((u) => ({ ...u, project_id: id }));
  const { data: made, error } = await admin
    .from("project_units")
    .upsert(drafts, { onConflict: "project_id,ref", ignoreDuplicates: true })
    .select("id");
  if (error) return fail("units_create_failed", 500, error);

  const created = made?.length ?? 0;
  logAction(req, user, "project.units.create", { project: id, created, skipped: drafts.length - created });
  return NextResponse.json({ ok: true, created, skipped: drafts.length - created });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await projectGate(req, id);
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const unitIds = ids(body.unitIds);
  const { unitIds: _drop, ...rest } = body;
  void _drop;
  const patch = parseUnitPatch(rest);
  if (!unitIds || !patch.ok) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: changed, error } = await admin
    .from("project_units")
    .update(patch.value)
    .eq("project_id", id)
    .in("id", unitIds)
    .select("id");
  if (error) return fail("units_update_failed", 500, error);
  logAction(req, user, "project.units.update", { project: id, count: changed?.length ?? 0, fields: Object.keys(patch.value) });
  return NextResponse.json({ ok: true, updated: changed?.length ?? 0 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await projectGate(req, id);
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;

  const unitIds = ids(((await req.json().catch(() => ({}))) as Record<string, unknown>).unitIds);
  if (!unitIds) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { data: gone, error } = await admin.from("project_units").delete().eq("project_id", id).in("id", unitIds).select("id");
  if (error) return fail("units_delete_failed", 500, error);
  logAction(req, user, "project.units.delete", { project: id, count: gone?.length ?? 0 });
  return NextResponse.json({ ok: true, deleted: gone?.length ?? 0 });
}
