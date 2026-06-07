import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { formatTND } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { InspectionActions } from "@/components/inspector/InspectionActions";
import { ClipboardCheck, Calendar, MapPin, FileText } from "lucide-react";

// Per-user, auth-gated dashboard — never static. Without this the build tries
// to prerender /fr/inspector, and in an env-less build (CI) getServerSupabase()
// throws during export and fails the whole build. Force-dynamic skips prerender.
export const dynamic = "force-dynamic";

/**
 * Inspector dashboard. Gated to role=inspector. Lists every assignment
 * grouped by lifecycle bucket (incoming → active → submitted → approved).
 */
export default async function InspectorDashboard({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations();
  const dateLocale = await getLocale();
  const isRTL = dateLocale === "ar";
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data: profile } = await supabase
    .from("profiles").select("role, full_name").eq("id", user!.id).single();
  if (profile?.role !== "inspector") {
    redirect({ href: "/account", locale: locale as "ar" | "fr" | "en" });
  }

  const { data: rows } = await supabase
    .from("inspections")
    .select(`
      id, kind, status, scheduled_at, fee_amount, report_pdf_path, created_at,
      property:properties (
        id, title, governorate, type,
        photos:property_photos (id, storage_path, sort_order)
      ),
      requester:profiles!inspections_requested_by_fkey (full_name)
    `)
    .eq("inspector_id", user!.id)
    .order("created_at", { ascending: false });

  const inspections = (rows ?? []) as unknown as Array<{
    id: string;
    kind: string;
    status: string;
    scheduled_at: string | null;
    fee_amount: number;
    report_pdf_path: string | null;
    created_at: string;
    property: {
      id: string;
      title: string;
      governorate: string;
      type: string;
      photos: { id: string; storage_path: string; sort_order: number }[];
    };
    requester: { full_name: string | null } | null;
  }>;

  const buckets = {
    incoming: inspections.filter((i) => i.status === "requested"),
    active: inspections.filter((i) => i.status === "scheduled" || i.status === "in_progress"),
    submitted: inspections.filter((i) => i.status === "submitted"),
    approved: inspections.filter((i) => i.status === "approved"),
  };

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <header>
        <span className="batta-eyebrow">Field assignments</span>
        <h1
          className={`mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight ${
            isRTL ? "font-arabic" : ""
          }`}
        >
          {t("inspector.title")}
        </h1>
        <p className="mt-1.5 text-[12.5px] text-muted">{t("inspector.subtitle")}</p>
      </header>

      {inspections.length === 0 ? (
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <ClipboardCheck className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">{t("inspector.noWork")}</p>
        </div>
      ) : (
        <>
          <Section title={t("inspector.tabs.incoming")} count={buckets.incoming.length} tone="amber">
            {buckets.incoming.map((i) => (
              <InspectionCard key={i.id} ins={i} t={t} dateLocale={dateLocale} showActions />
            ))}
          </Section>
          <Section title={t("inspector.tabs.active")} count={buckets.active.length} tone="gold">
            {buckets.active.map((i) => (
              <InspectionCard key={i.id} ins={i} t={t} dateLocale={dateLocale} showActions />
            ))}
          </Section>
          <Section title={t("inspector.tabs.submitted")} count={buckets.submitted.length} tone="info">
            {buckets.submitted.map((i) => (
              <InspectionCard key={i.id} ins={i} t={t} dateLocale={dateLocale} />
            ))}
          </Section>
          <Section title={t("inspector.tabs.approved")} count={buckets.approved.length} tone="emerald">
            {buckets.approved.map((i) => (
              <InspectionCard key={i.id} ins={i} t={t} dateLocale={dateLocale} />
            ))}
          </Section>
        </>
      )}

      <div aria-hidden className="h-6" />
    </div>
  );
}

function Section({
  title, count, tone, children,
}: {
  title: string;
  count: number;
  tone: "amber" | "gold" | "info" | "emerald";
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const dotClass = {
    amber: "bg-warning",
    gold: "bg-gold",
    info: "bg-info",
    emerald: "bg-success",
  }[tone];
  return (
    <section className="mt-6">
      <h2 className="batta-eyebrow flex items-center gap-2">
        <span className={`size-2 rounded-full ${dotClass}`} />
        {title} · {count}
      </h2>
      <ul className="mt-3 space-y-2">{children}</ul>
    </section>
  );
}

function InspectionCard({
  ins, t, dateLocale, showActions,
}: {
  ins: {
    id: string;
    kind: string;
    status: string;
    scheduled_at: string | null;
    fee_amount: number;
    report_pdf_path: string | null;
    property: {
      id: string;
      title: string;
      governorate: string;
      photos: { id: string; storage_path: string; sort_order: number }[];
    };
    requester: { full_name: string | null } | null;
  };
  t: Awaited<ReturnType<typeof getTranslations>>;
  dateLocale: string;
  showActions?: boolean;
}) {
  const photo = ins.property.photos?.sort((a, b) => a.sort_order - b.sort_order)[0];
  return (
    <li className="overflow-hidden rounded-xl bg-surface ring-1 ring-border transition-all hover:ring-gold-soft/40">
      <div className="flex gap-3 p-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-surface-2">
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={propertyPhotoUrl(photo.storage_path)}
              alt={ins.property.title}
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold text-foreground">{ins.property.title}</div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
            <MapPin className="size-3 shrink-0" strokeWidth={2} />
            {ins.property.governorate}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full bg-gold-faint px-2 py-0.5 font-bold text-gold-bright ring-1 ring-gold/30">
              {t(`inspector.kind.${ins.kind}` as "inspector.kind.standard")}
            </span>
            <span className="batta-tabular rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-foreground/85 ring-1 ring-border">
              {t("inspector.fee")}: {formatTND(ins.fee_amount, dateLocale)} TND
            </span>
          </div>
          {ins.requester?.full_name && (
            <div className="mt-1 truncate text-[10px] text-muted">
              {t("inspector.for")}: {ins.requester.full_name}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1 text-[10px] text-muted">
            <Calendar className="size-3 shrink-0" strokeWidth={2} />
            {ins.scheduled_at
              ? t("inspector.scheduled", { date: new Date(ins.scheduled_at).toLocaleString(dateLocale) })
              : t("inspector.noSlot")}
          </div>
        </div>
      </div>

      {ins.report_pdf_path && (
        <a
          href={`/api/inspector/report/${ins.id}`}
          className="flex items-center gap-2 border-t border-border bg-surface-2 px-3 py-2 text-[11px] font-bold text-gold-bright"
          target="_blank" rel="noopener noreferrer"
        >
          <FileText className="size-3.5" strokeWidth={2.2} />
          {t("inspector.actions.openReport")}
        </a>
      )}

      {showActions && (
        <InspectionActions inspectionId={ins.id} status={ins.status} />
      )}
    </li>
  );
}
