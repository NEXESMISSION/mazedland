import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatTND } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel } from "@/lib/delegations";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { deliveryParts, priceFrom, unitCounts, type ProjectKind, type UnitStatus } from "@/lib/pro/projects";
import { getSettings } from "@/lib/settings/server";
import { ProjectForm, ProjectStatusActions, UnitGenerator, UnitsTable, type UnitRow } from "./ProjectsPanel";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";

type ProjectRow = {
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
  status: string;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-surface-2 text-muted ring-1 ring-border",
  published: "mazed-tone-ok",
  archived: "mazed-tone-warn",
};

/**
 * « Projets » in the agence dashboard (0179): the agence's projects with
 * what is left to sell, a form for a new one — or, with ?p=, one project:
 * its page's fields, its status, the unit generator and the units table.
 */
export async function ProjectsTab({
  shopId,
  shopSlug,
  shopGovernorate,
  projectId,
  hasPlan,
}: {
  shopId: string;
  shopSlug: string;
  shopGovernorate: string;
  projectId?: string;
  hasPlan: boolean;
}) {
  const t = await getTranslations("pro.projects");
  const locale = await getLocale();
  const admin = getServiceSupabase()!;
  const settings = await getSettings();
  const today = new Date().toISOString().slice(0, 10);
  const delivery = (v: string | null) => {
    const p = deliveryParts(v);
    return !p ? t("delivery.none") : p.delivered ? t("delivery.delivered") : t("delivery.quarter", { q: String(p.q), year: String(p.year) });
  };
  const place = (p: Pick<ProjectRow, "governorate" | "delegation">) =>
    `${p.delegation ? `${delegationLabel(p.delegation, locale)}, ` : ""}${governorateLabel(p.governorate, locale)}`;
  const planHint = settings.projects_need_plan && !hasPlan && (
    <p className="rounded-2xl mazed-tone-warn px-4 py-3 text-[12.5px] leading-relaxed">{t("planHint")}</p>
  );

  // ── One project ──
  if (projectId) {
    const [{ data: row }, { data: unitRows }] = await Promise.all([
      admin.from("projects").select("*").eq("id", projectId).eq("shop_id", shopId).maybeSingle(),
      admin
        .from("project_units")
        .select("id, ref, kind, floor, rooms, area_sqm, price, status, sort_order")
        .eq("project_id", projectId)
        .order("sort_order")
        .order("ref"),
    ]);
    const project = row as ProjectRow | null;
    if (!project) return <p className="mt-5 text-[13px] text-muted">{t("empty")}</p>;
    const units = ((unitRows ?? []) as (UnitRow & { sort_order: number })[]).map((u) => ({
      ...u,
      area_sqm: u.area_sqm === null ? null : Number(u.area_sqm),
      price: u.price === null ? null : Number(u.price),
      status: u.status as UnitStatus,
    }));
    const counts = unitCounts(units);
    // The next lot number: after the highest « Lot n », « Villa n », « P n ».
    const nextLot = units.reduce((n, u) => Math.max(n, Number(/(\d+)$/.exec(u.ref)?.[1] ?? 0) + 1), 1);

    return (
      <section className="mt-5 space-y-5">
        <Link href={`/pro/dashboard?shop=${shopId}&tab=projets` as never} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-muted hover:text-foreground">
          <ArrowLeft className="size-3.5 rtl:-scale-x-100" /> {t("back")}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-extrabold tracking-tight text-foreground" dir="auto">{project.name}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted">
              {t(`kinds.${project.kind}`)} · {place(project)} · {t("delivery.label")} : {delivery(project.delivery)}
            </p>
            <p className="mt-1 text-[12.5px] text-foreground">{t("counts", counts)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STATUS_TONE[project.status] ?? ""}`}>{t(`status.${project.status}`)}</span>
            {project.status === "published" && (
              <Link href={`/agences/${shopSlug}/projets/${project.slug}` as never} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-gold hover:underline">
                {t("actions.view")} <ExternalLink className="size-3.5" />
              </Link>
            )}
          </div>
        </header>
        {planHint}
        <ProjectStatusActions shopId={shopId} projectId={project.id} status={project.status} />
        <UnitGenerator projectId={project.id} maxUnits={settings.projects_max_units} nextLot={nextLot} />
        <UnitsTable projectId={project.id} units={units} />
        <details className="rounded-2xl border border-border bg-surface p-4">
          <summary className="cursor-pointer text-[14px] font-extrabold text-foreground">{t("form.edit")}</summary>
          <div className="mt-4">
            <ProjectForm
              shopId={shopId}
              projectId={project.id}
              today={today}
              defaultGovernorate={shopGovernorate}
              initial={{
                name: project.name,
                kind: project.kind,
                governorate: project.governorate,
                delegation: project.delegation ?? "",
                address: project.address ?? "",
                delivery: project.delivery ?? "",
                description: project.description ?? "",
                cover_path: project.cover_path,
              }}
            />
          </div>
        </details>
      </section>
    );
  }

  // ── The list, and a new one ──
  const { data: rows } = await admin
    .from("projects")
    .select("id, slug, name, kind, governorate, delegation, delivery, cover_path, status, units:project_units (status, price)")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });
  const projects = (rows ?? []) as unknown as (ProjectRow & { units: { status: string; price: number | null }[] })[];

  return (
    <section className="mt-5 space-y-5">
      <p className="text-[13px] leading-relaxed text-muted">{t("intro")}</p>
      {planHint}
      {projects.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-[13px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((p) => {
            const counts = unitCounts(p.units);
            const from = priceFrom(p.units);
            return (
              <li key={p.id}>
                <Link
                  href={`/pro/dashboard?shop=${shopId}&tab=projets&p=${p.id}` as never}
                  className="flex gap-3 rounded-2xl border border-border bg-surface p-3 transition hover:border-gold-soft"
                >
                  <span className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                    {p.cover_path && (
                      // eslint-disable-next-line @next/next/no-img-element -- the project's own cover
                      <img src={propertyPhotoUrl(p.cover_path, { transform: { width: 200, quality: 70 } })} alt="" className="size-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-extrabold text-foreground" dir="auto">{p.name}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS_TONE[p.status] ?? ""}`}>{t(`status.${p.status}`)}</span>
                    </span>
                    <span className="block text-[12px] text-muted">{t(`kinds.${p.kind}`)} · {place(p)} · {delivery(p.delivery)}</span>
                    <span className="mt-1 block text-[12px] text-foreground">{t("counts", counts)}</span>
                    {from !== null && <span className="block text-[12px] font-bold text-gold">{t("priceFrom", { price: formatTND(from, locale) })}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <details className="rounded-2xl border border-border bg-surface p-4" open={projects.length === 0}>
        <summary className="flex cursor-pointer items-center gap-1.5 text-[14px] font-extrabold text-foreground">
          <Plus className="size-4" /> {t("new")}
        </summary>
        <div className="mt-4">
          <ProjectForm shopId={shopId} today={today} defaultGovernorate={shopGovernorate} />
        </div>
      </details>
    </section>
  );
}
