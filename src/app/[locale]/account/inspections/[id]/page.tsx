import { notFound } from "next/navigation";
import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getTranslations, getLocale } from "next-intl/server";
import { formatTND } from "@/lib/utils";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import {
  ArrowLeft, MapPin, Calendar, FileText, ClipboardCheck, User, Building2,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Single inspection — the deep target for inspection notifications
 * (requested / scheduled / completed). RLS on `inspections` decides
 * visibility (requester + assigned inspector + admin), so a stranger's id
 * simply returns no row → 404.
 */
export default async function InspectionDetailPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const t = await getTranslations();
  const dateLocale = await getLocale();
  const supabase = await getServerSupabase();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data } = await supabase
    .from("inspections")
    .select(`
      id, kind, status, scheduled_at, fee_amount, report_pdf_path, notes, created_at,
      inspector_id,
      property:properties (
        id, title, governorate, address,
        photos:property_photos (id, storage_path, sort_order)
      )
    `)
    .eq("id", id)
    .maybeSingle();

  if (!data) notFound();

  const ins = data as unknown as {
    id: string;
    kind: string;
    status: string;
    scheduled_at: string | null;
    fee_amount: number;
    report_pdf_path: string | null;
    notes: string | null;
    inspector_id: string | null;
    property: {
      id: string;
      title: string;
      governorate: string;
      address: string | null;
      photos: { id: string; storage_path: string; sort_order: number }[];
    } | null;
  };

  // Inspector contact (name + phone) via a relationship-scoped RPC: it returns
  // the assigned inspector's details ONLY to a party of this inspection. The
  // broad profiles.phone read this replaced was the authenticated PII leak
  // (anyone could read any inspector's phone); names/phones are no longer
  // directly readable cross-user (see migration 0080).
  let inspector: { full_name: string | null; phone: string | null } | null = null;
  if (ins.inspector_id) {
    const { data: contact } = await supabase.rpc("get_inspection_contact", {
      p_inspection_id: id,
    });
    inspector = (contact as { full_name: string | null; phone: string | null }[] | null)?.[0] ?? null;
  }

  const photo = ins.property?.photos?.sort((a, b) => a.sort_order - b.sort_order)[0];
  const reportReady = ins.status === "submitted" || ins.status === "approved";
  const tone =
    ins.status === "approved" ? "batta-tone-ok"
    : ins.status === "submitted" ? "bg-gold-faint text-gold-bright ring-1 ring-gold/30"
    : ins.status === "in_progress" ? "bg-gold-faint text-gold ring-1 ring-gold/30"
    : ins.status === "scheduled" ? "bg-surface-2 text-muted ring-1 ring-border"
    : ins.status === "cancelled" ? "batta-tone-bad"
    : "bg-surface-2 text-muted ring-1 ring-border";

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-16 lg:max-w-[var(--max-w-content)]">
      <Link
        href="/account/inspections"
        className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-muted hover:text-gold-bright"
      >
        <ArrowLeft className="size-3.5" /> {t("account.myInspections")}
      </Link>

      {/* Property hero */}
      <div className="mt-3 overflow-hidden rounded-2xl bg-surface ring-1 ring-border">
        <div className="relative aspect-[16/9] bg-surface-2">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={propertyPhotoUrl(photo.storage_path)}
              alt={ins.property?.title ?? ""}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-foreground/15">
              <Building2 className="size-10" />
            </div>
          )}
          <span
            className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em] ${tone}`}
          >
            {ins.status.replace(/_/g, " ")}
          </span>
        </div>
        <div className="p-4">
          <h1 className="text-[18px] font-extrabold leading-tight tracking-tight">
            {ins.property?.title ?? "—"}
          </h1>
          <div className="mt-1 flex items-center gap-1 text-[12px] text-muted">
            <MapPin className="size-3.5" strokeWidth={2} />
            {ins.property?.governorate}
            {ins.property?.address ? ` · ${ins.property.address}` : ""}
          </div>
          {ins.property && (
            <Link
              href={`/auctions/${ins.property.id}` as `/auctions/${string}`}
              className="mt-2 inline-flex text-[12px] font-bold text-gold-bright hover:underline"
            >
              Voir l&apos;annonce →
            </Link>
          )}
        </div>
      </div>

      {/* Details */}
      <section className="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <h2 className="batta-eyebrow mb-3 flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Inspection
        </h2>
        <dl className="grid grid-cols-2 gap-3">
          <Row label="Type" value={t(`inspector.kind.${ins.kind}` as "inspector.kind.standard")} />
          <Row label="Frais" value={`${formatTND(ins.fee_amount, dateLocale)} TND`} />
          <Row
            label="Date prévue"
            value={ins.scheduled_at ? new Date(ins.scheduled_at).toLocaleString(dateLocale) : "À planifier"}
            Icon={Calendar}
          />
          <Row
            label="Inspecteur"
            value={inspector?.full_name ?? "Non assigné"}
            Icon={User}
          />
        </dl>
        {ins.notes && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="batta-eyebrow mb-1">Notes</div>
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/85">
              {ins.notes}
            </p>
          </div>
        )}
      </section>

      {/* Report */}
      <section className="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <h2 className="batta-eyebrow mb-3 flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Rapport
        </h2>
        {reportReady ? (
          <a
            href={`/api/inspector/report/${ins.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="batta-btn-luxe tap-target inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px]"
          >
            <FileText className="size-4" strokeWidth={2.2} />
            {t("inspector.actions.openReport")}
          </a>
        ) : (
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-3 text-[12.5px] text-muted">
            <ClipboardCheck className="size-4 shrink-0 text-gold" />
            Le rapport sera disponible ici une fois l&apos;inspection terminée.
          </div>
        )}
      </section>
    </div>
  );
}

function Row({
  label, value, Icon,
}: {
  label: string;
  value: string;
  Icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <div className="rounded-xl bg-surface-2 p-3 ring-1 ring-border">
      <div className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
      <div className="mt-0.5 inline-flex items-center gap-1.5 text-[14px] font-bold text-foreground">
        {Icon && <Icon className="size-3.5 text-gold" strokeWidth={2} />}
        {value}
      </div>
    </div>
  );
}
