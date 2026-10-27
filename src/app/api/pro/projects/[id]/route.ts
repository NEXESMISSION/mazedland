import { NextRequest, NextResponse } from "next/server";
import { projectGate } from "@/lib/pro/api";
import { activePlan } from "@/lib/pro/shops";
import { PROJECT_STATUSES, parseProjectInput, type ProjectStatus } from "@/lib/pro/projects";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * PATCH  /api/pro/projects/:id  { …fields, status? } — edit a project, publish,
 *        archive or take it back to draft.
 * DELETE /api/pro/projects/:id — a draft or an archived project, units and all.
 *
 * Publishing needs an approved agence, at least one unit, and — when the
 * console asks for it (projects_need_plan) — a running plan.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_projects");
  if (off) return off;
  const { id } = await params;
  const gate = await projectGate(req, id);
  if (gate instanceof NextResponse) return gate;
  const { user, admin, project } = gate;
  const t = await apiTranslator(req, "proApi.projects");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { status: wanted, ...sent } = body;
  // A délégation sent without its governorate is checked against the project's.
  let fields = sent;
  if ("delegation" in sent && !("governorate" in sent)) {
    const { data: current } = await admin.from("projects").select("governorate").eq("id", id).single();
    fields = { ...sent, governorate: current?.governorate };
  }
  const parsed = parseProjectInput(fields, { partial: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", field: parsed.field, detail: t(`field.${parsed.field}`) }, { status: 400 });
  }
  const update: Record<string, unknown> = { ...parsed.value };

  if (wanted !== undefined) {
    if (!(PROJECT_STATUSES as readonly unknown[]).includes(wanted)) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const status = wanted as ProjectStatus;
    if (status === "published" && project.status !== "published") {
      const [{ data: shop }, { count: units }, settings] = await Promise.all([
        admin.from("shops").select("status").eq("id", project.shop_id).maybeSingle(),
        admin.from("project_units").select("id", { count: "exact", head: true }).eq("project_id", id),
        getSettings(),
      ]);
      if (shop?.status !== "approved") return NextResponse.json({ error: "conflict", detail: t("shopNotApproved") }, { status: 409 });
      if (!units) return NextResponse.json({ error: "no_units", detail: t("noUnits") }, { status: 409 });
      if (settings.projects_need_plan && !(await activePlan(admin, project.shop_id))) {
        return NextResponse.json({ error: "plan_required", detail: t("planRequired") }, { status: 402 });
      }
      update.published_at = new Date().toISOString();
    }
    update.status = status;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const { error } = await admin.from("projects").update(update).eq("id", id);
  if (error) return fail("project_update_failed", 500, error);
  logAction(req, user, wanted ? `project.${String(wanted)}` : "project.update", { project: id, fields: Object.keys(update) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await projectGate(req, id);
  if (gate instanceof NextResponse) return gate;
  const { user, admin, project } = gate;
  if (project.status === "published") {
    const t = await apiTranslator(req, "proApi.projects");
    return NextResponse.json({ error: "conflict", detail: t("archiveFirst") }, { status: 409 });
  }
  const { error } = await admin.from("projects").delete().eq("id", id).neq("status", "published");
  if (error) return fail("project_delete_failed", 500, error);
  logAction(req, user, "project.delete", { project: id, name: project.name });
  return NextResponse.json({ ok: true });
}
