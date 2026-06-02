import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { formatTND } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { ClipboardCheck, Calendar, MapPin, FileText } from "lucide-react";
import { FocusRowHighlight } from "@/components/ui/FocusRowHighlight";

/**
 * Buyer-side inspections — surfaces the report download once an
 * inspection reaches `submitted` or `approved` (audit #11).
 */
export default async function MyInspectionsPage({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations();
  const dateLocale = await getLocale();
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data: rows } = await supabase
    .from("inspections")
    .select(`
      id, kind, status, scheduled_at, fee_amount, report_pdf_path, created_at,
      inspector_id,
      property:properties (
        id, title, governorate,
        photos:property_photos (id, storage_path, sort_order)
      )
    `)
    .eq("requested_by", user!.id)
    .order("created_at", { ascending: false });

  const inspections = (rows ?? []) as unknown as Array<{
    id: string;
    kind: string;
    status: string;
    scheduled_at: string | null;
    fee_amount: number;
    report_pdf_path: string | null;
    inspector_id: string | null;
    property: {
      id: string;
      title: string;
      governorate: string;
      photos: { id: string; storage_path: string; sort_order: number }[];
    } | null;
  }>;

  // Inspector names live in profiles (the inspector FK targets `inspectors`,
  // whose id == the profile id) — resolve them in one batched lookup rather
  // than a PostgREST embed, which can't follow that two-hop relationship.
  const inspectorIds = Array.from(
    new Set(inspections.map((i) => i.inspector_id).filter(Boolean) as string[]),
  );
  const inspectorNames = new Map<string, string>();
  if (inspectorIds.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", inspectorIds);
    for (const p of profs ?? []) {
      if (p.full_name) inspectorNames.set(p.id as string, p.full_name as string);
    }
  }

  // French labels for the inspection lifecycle (was rendering raw enum values
  // like "in progress" via replace(/_/g," ") in an otherwise French app).
  const STATUS_FR: Record<string, string> = {
    requested: "Demandée",
    scheduled: "Planifiée",
    in_progress: "En cours",
    submitted: "Rapport prêt",
    approved: "Approuvée",
    completed: "Terminée",
    cancelled: "Annulée",
  };

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 lg:max-w-[var(--max-w-content)]">
      <FocusRowHighlight idPrefix="ins-" />
      <span className="batta-eyebrow">Rapports d&apos;inspection</span>
      <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        {t("account.myInspections")}
      </h1>
      <p className="mt-1.5 text-[12px] text-muted">{t("account.myInspectionsBody")}</p>

      {inspections.length === 0 ? (
        <div className="batta-frame-gold relative mt-6 px-6 py-10 text-center">
          <ClipboardCheck className="mx-auto size-8 text-gold" strokeWidth={2} />
          <p className="mt-3 text-[13px] text-muted">Aucune inspection pour le moment.</p>
          <Link
            href="/properties"
            className="batta-btn-luxe tap-target mt-5 inline-flex px-5 py-2.5 text-[12.5px]"
          >
            Parcourir les biens
          </Link>
        </div>
      ) : (
        <ul className="mt-4 space-y-2.5 pb-6">
          {inspections.map((ins) => {
            if (!ins.property) return null;
            const photo = ins.property.photos?.sort((a, b) => a.sort_order - b.sort_order)[0];
            const reportReady = ins.status === "submitted" || ins.status === "approved";
            const tone =
              ins.status === "approved" ? "batta-tone-ok"
              : ins.status === "submitted" ? "bg-gold-faint text-gold-bright border-y border-gold/30"
              : ins.status === "in_progress" ? "bg-gold-faint text-gold border-y border-gold/30"
              : ins.status === "scheduled" ? "bg-surface-2 text-muted border-y border-border"
              : ins.status === "cancelled" ? "batta-tone-bad"
              : "bg-surface-2 text-muted border-y border-border";
            return (
              <li
                key={ins.id}
                id={`ins-${ins.id}`}
                className="overflow-hidden rounded-xl bg-surface ring-1 ring-border transition-all hover:ring-gold-soft/40"
              >
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
                    <div className="truncate text-[14px] font-bold text-foreground">
                      {ins.property.title}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted">
                      <MapPin className="size-3 shrink-0" strokeWidth={2} />
                      {ins.property.governorate}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                      <span className="rounded-full bg-gold-faint px-2 py-0.5 font-bold text-gold-bright ring-1 ring-gold/30">
                        {t(`inspector.kind.${ins.kind}` as "inspector.kind.standard")}
                      </span>
                      <span className="batta-tabular rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-foreground/85 ring-1 ring-border">
                        {formatTND(ins.fee_amount, dateLocale)} TND
                      </span>
                    </div>
                    {ins.inspector_id && inspectorNames.get(ins.inspector_id) && (
                      <div className="mt-1 truncate text-[10px] text-muted">
                        {inspectorNames.get(ins.inspector_id)}
                      </div>
                    )}
                    {ins.scheduled_at && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted">
                        <Calendar className="size-3 shrink-0" strokeWidth={2} />
                        {new Date(ins.scheduled_at).toLocaleString(dateLocale)}
                      </div>
                    )}
                  </div>
                </div>
                <div className={`flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
                  <span>{STATUS_FR[ins.status] ?? ins.status.replace(/_/g, " ")}</span>
                  {reportReady && (
                    <a
                      href={`/api/inspector/report/${ins.id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="batta-gold-fill tap-target inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] shadow-[var(--shadow-gold)]"
                    >
                      <FileText className="size-3" strokeWidth={2.5} />
                      {t("inspector.actions.openReport")}
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
