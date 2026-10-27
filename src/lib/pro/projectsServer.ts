import type { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { activePlan } from "./shops";
import type { ProjectKind } from "./projects";

/**
 * What the public sees of an agence's projects (0179). A project shows when
 * the feature is on, it is published, and — if the console asks for it
 * (projects_need_plan) — its agence has a running plan. The agence page and
 * the project page both ask here, so they never disagree.
 */

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export type PublicProject = {
  id: string;
  slug: string;
  name: string;
  kind: ProjectKind;
  description: string | null;
  governorate: string;
  delegation: string | null;
  address: string | null;
  delivery: string | null;
  cover_path: string | null;
  units: { id: string; ref: string; kind: string; block: string | null; floor: number | null; rooms: number | null; area_sqm: number | null; price: number | null; status: string; sort_order: number }[];
};

const COLUMNS =
  "id, slug, name, kind, description, governorate, delegation, address, delivery, cover_path, units:project_units (id, ref, kind, block, floor, rooms, area_sqm, price, status, sort_order)";

/** Whether this agence's projects may show at all right now. */
export async function projectsShown(admin: Admin, shopId: string): Promise<boolean> {
  const s = await getSettings();
  if (!s.feature_projects) return false;
  return !s.projects_need_plan || (await activePlan(admin, shopId)) !== null;
}

const normalise = (p: PublicProject): PublicProject => ({
  ...p,
  units: [...(p.units ?? [])]
    .map((u) => ({ ...u, area_sqm: u.area_sqm === null ? null : Number(u.area_sqm), price: u.price === null ? null : Number(u.price) }))
    .sort((a, b) => a.sort_order - b.sort_order || a.ref.localeCompare(b.ref, "fr", { numeric: true })),
});

/** The agence's published projects, newest first — none when they may not show. */
export async function publishedProjects(admin: Admin, shopId: string): Promise<PublicProject[]> {
  if (!(await projectsShown(admin, shopId))) return [];
  const { data } = await admin
    .from("projects")
    .select(COLUMNS)
    .eq("shop_id", shopId)
    .eq("status", "published")
    .order("published_at", { ascending: false });
  return ((data ?? []) as unknown as PublicProject[]).map(normalise);
}

/** One published project of the agence, by its slug — null when it may not show. */
export async function publicProject(admin: Admin, shopId: string, slug: string): Promise<PublicProject | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || !(await projectsShown(admin, shopId))) return null;
  const { data } = await admin
    .from("projects")
    .select(COLUMNS)
    .eq("shop_id", shopId)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  return data ? normalise(data as unknown as PublicProject) : null;
}
