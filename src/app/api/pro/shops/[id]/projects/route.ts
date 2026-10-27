import { NextRequest, NextResponse } from "next/server";
import { proGate } from "@/lib/pro/api";
import { slugify } from "@/lib/pro/shops";
import { parseProjectInput } from "@/lib/pro/projects";
import { featureOff } from "@/lib/settings/gate";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";

/**
 * POST /api/pro/shops/:id/projects — a new project (0179), as a draft: its
 * units are added next, and it goes public from the dashboard. The owner and
 * the admins of the agence may do it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = await featureOff("feature_projects");
  if (off) return off;
  const { id } = await params;
  const gate = await proGate(req, { id, action: "projects" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi.projects");

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseProjectInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "invalid", field: parsed.field, detail: t(`field.${parsed.field}`) }, { status: 400 });
  }

  // A slug of the name, unique within the agence: residence-les-jasmins, -2, -3…
  const base = slugify(parsed.value.name!, id).replace(/^agence-/, "projet-");
  const { data: taken } = await admin.from("projects").select("slug").eq("shop_id", id).like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((p) => p.slug as string));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;

  const { data: created, error } = await admin
    .from("projects")
    .insert({ ...parsed.value, shop_id: id, slug, status: "draft", created_by: user.id })
    .select("id, slug")
    .single();
  if (error || !created) return fail("project_create_failed", 500, error);

  logAction(req, user, "project.create", { shop: id, project: created.id });
  return NextResponse.json({ ok: true, id: created.id, slug: created.slug });
}
