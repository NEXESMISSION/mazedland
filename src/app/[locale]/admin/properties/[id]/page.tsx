import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import { ApprovePropertyButtons } from "@/components/admin/ApprovePropertyButtons";
import { ImageLightbox } from "@/components/ui/ImageLightbox";
import { PropertyDocumentOpenButton } from "@/components/property/PropertyDocumentOpenButton";
import type { PropertyType } from "@/lib/types";
import {
  ArrowLeft, MapPin, FileText, Download, ImageOff, Wallet,
  User, Phone, Calendar,
} from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KIND_TO_FR: Record<string, string> = {
  apartment: "Appartement", house: "Maison", villa: "Villa", land: "Terrain",
  commercial: "Local commercial", office: "Bureau", warehouse: "Entrepôt", farm: "Ferme",
};

const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  pending:        { label: "En attente de reçu", tone: "batta-tone-warn" },
  pending_review: { label: "Reçu à vérifier",    tone: "batta-tone-warn" },
  captured:       { label: "Payé / validé",      tone: "batta-tone-ok" },
  failed:         { label: "Refusé",             tone: "batta-tone-bad" },
  cancelled:      { label: "Annulé",             tone: "bg-surface-2 text-muted ring-1 ring-border" },
};

export default async function AdminPropertyReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();

  const { data: prop } = await supabase
    .from("properties")
    .select(
      `id, title, description, type, status, rejection_reason, governorate, address,
       area_sqm, rooms, bathrooms, floor, year_built, attributes, created_at, owner_id,
       photos:property_photos (id, storage_path, sort_order),
       documents:property_documents (id, kind, uploaded_at),
       owner:profiles!properties_owner_id_fkey (full_name, phone)`,
    )
    .eq("id", id)
    .single();
  if (!prop) notFound();

  const type = prop.type as PropertyType;
  const photos = ((prop.photos ?? []) as { id: string; storage_path: string; sort_order: number }[])
    .sort((a, b) => a.sort_order - b.sort_order);
  const documents = (prop.documents ?? []) as { id: string; kind: string; uploaded_at: string }[];
  type OwnerRow = { full_name: string | null; phone: string | null };
  const ownerRaw = prop.owner as unknown as OwnerRow | OwnerRow[] | null;
  const owner: OwnerRow | null = Array.isArray(ownerRaw) ? (ownerRaw[0] ?? null) : ownerRaw;

  // ─── Characteristics: catalog + values (legacy-column backfill) ─────────
  const { data: attrKindRows } = await supabase
    .from("property_attribute_kinds")
    .select("field_key, label, data_type, options, unit, sort_order")
    .eq("property_type", type)
    .order("sort_order")
    .order("label");
  const attrKinds = (attrKindRows ?? []) as Array<{
    field_key: string; label: string; data_type: string;
    options: { value: string; label: string }[] | null; unit: string | null;
  }>;
  const attrs: Record<string, string | number | boolean> = {
    ...((prop.attributes as Record<string, string | number | boolean> | null) ?? {}),
  };
  const legacy: Record<string, number | null> = {
    area_sqm: prop.area_sqm as number | null,
    rooms: prop.rooms as number | null,
    bathrooms: prop.bathrooms as number | null,
    floor: prop.floor as number | null,
    year_built: prop.year_built as number | null,
  };
  for (const [k, v] of Object.entries(legacy)) {
    if (attrs[k] == null && v != null) attrs[k] = v;
  }
  const specs = attrKinds
    .map((k) => {
      const raw = attrs[k.field_key];
      if (raw == null || raw === "" || raw === false) return null;
      let value: string;
      if (k.data_type === "boolean") value = "Oui";
      else if (k.data_type === "select")
        value = k.options?.find((o) => o.value === raw)?.label ?? String(raw);
      else value = k.unit ? `${raw} ${k.unit}` : String(raw);
      return { label: k.label, value };
    })
    .filter((s): s is { label: string; value: string } => s !== null);

  // ─── Linked listing-fee payment + signed receipt ────────────────────────
  const { data: payRow } = await supabase
    .from("payments")
    .select("id, amount, status, provider, receipt_url, receipt_uploaded_at, metadata, created_at")
    .eq("property_id", id)
    .eq("kind", "listing_fee")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let receiptUrl: string | null = null;
  if (payRow?.receipt_url) {
    const { data: signed } = await supabase.storage
      .from("receipts")
      .createSignedUrl(payRow.receipt_url as string, 3600);
    receiptUrl = signed?.signedUrl ?? null;
  }
  const promos = (payRow?.metadata as { promos?: Record<string, boolean> } | null)?.promos ?? null;

  // If a listing-fee receipt is awaiting validation, "Valider" should accept
  // the payment (capture + publish + apply the promos the seller bought),
  // so a paid listing is validated in one place. Free listings (no pending
  // receipt) fall back to a plain property approval.
  const acceptPaymentId =
    payRow && (payRow.status as string) === "pending_review" ? (payRow.id as string) : undefined;
  const promoDurations = promos
    ? {
        home_featured: promos.home_featured ? 30 : 0,
        top_listed: promos.top_listed ? 30 : 0,
        banner: promos.banner ? 30 : 0,
      }
    : undefined;

  const status = prop.status as string;

  return (
    <div className="pb-16">
      <Link
        href="/admin/properties"
        className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-muted hover:text-gold-bright"
      >
        <ArrowLeft className="size-3.5" /> File des annonces
      </Link>

      {/* Header */}
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="batta-eyebrow">Revue d&apos;annonce</span>
          <h1 className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight">
            {prop.title as string}
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" /> {prop.governorate as string}
              {prop.address ? ` · ${prop.address as string}` : ""}
            </span>
            <span>{KIND_TO_FR[type] ?? type}</span>
            <span className="inline-flex items-center gap-1">
              <Calendar className="size-3" />
              {new Date(prop.created_at as string).toLocaleDateString("fr-FR")}
            </span>
          </div>
        </div>
        <StatusPill status={status} />
      </div>

      {status === "rejected" && prop.rejection_reason && (
        <div className="batta-tone-bad mt-3 rounded-lg px-3 py-2 text-[12px]">
          Motif du refus : {prop.rejection_reason as string}
        </div>
      )}

      {/* Decision bar */}
      <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <p className="text-[12px] text-muted">
          {status === "pending_review"
            ? "Vérifiez photos, documents et reçu, puis décidez."
            : "Cette annonce a déjà été traitée."}
        </p>
        <ApprovePropertyButtons
          id={id}
          status={status}
          acceptPaymentId={acceptPaymentId}
          promoDurations={promoDurations}
        />
      </div>

      {/* Photos */}
      <Card title={`Photos · ${photos.length}`}>
        {photos.length === 0 ? (
          <Empty icon={<ImageOff className="size-5" />} text="Aucune photo." />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((ph, i) => (
              <ImageLightbox
                key={ph.id}
                src={propertyPhotoUrl(ph.storage_path)}
                alt={`Photo ${i + 1}`}
                triggerClassName="relative aspect-square w-full overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={propertyPhotoUrl(ph.storage_path)}
                  alt={`Photo ${i + 1}`}
                  className="size-full object-cover"
                />
                {i === 0 && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-black/65 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.12em] text-white">
                    Couverture
                  </span>
                )}
              </ImageLightbox>
            ))}
          </div>
        )}
      </Card>

      {/* Characteristics */}
      <Card title="Caractéristiques">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Spec label="Type" value={KIND_TO_FR[type] ?? type} />
          {specs.map((s) => (
            <Spec key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
        {prop.description && (
          <div className="mt-3 border-t border-border pt-3">
            <div className="batta-eyebrow mb-1">Description</div>
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-foreground/85">
              {prop.description as string}
            </p>
          </div>
        )}
      </Card>

      {/* Documents */}
      <Card title={`Documents légaux · ${documents.length}`}>
        {documents.length === 0 ? (
          <Empty icon={<FileText className="size-5" />} text="Aucun document fourni." />
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-border"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <FileText className="size-4 shrink-0 text-gold" />
                  <span className="truncate text-[13px] font-semibold text-foreground">
                    {d.kind}
                  </span>
                </div>
                <PropertyDocumentOpenButton
                  docId={d.id}
                  title={d.kind}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-batta-gold/12 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-batta-gold-bright ring-1 ring-batta-gold/30 transition hover:bg-batta-gold/20 active:scale-95"
                >
                  <Download className="size-3.5" /> Ouvrir
                </PropertyDocumentOpenButton>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Payment + receipt */}
      <Card title="Paiement · frais d'annonce">
        {!payRow ? (
          <Empty icon={<Wallet className="size-5" />} text="Aucun paiement initié." />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="batta-tabular text-[20px] font-extrabold text-foreground">
                  {formatTND(Number(payRow.amount), "fr")}
                </div>
                <div className="mt-0.5 text-[11px] text-muted">
                  {payRow.provider === "bank_transfer"
                    ? "Virement bancaire (RIB)"
                    : payRow.provider === "d17"
                      ? "D17 (mobile)"
                      : (payRow.provider as string)}
                  {promos &&
                    (promos.home_featured || promos.top_listed || promos.banner) && (
                      <>
                        {" · options : "}
                        {[
                          promos.home_featured && "Accueil",
                          promos.top_listed && "Top recherche",
                          promos.banner && "Bannière",
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </>
                    )}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${
                  PAY_STATUS[payRow.status as string]?.tone ??
                  "bg-surface-2 text-muted ring-1 ring-border"
                }`}
              >
                {PAY_STATUS[payRow.status as string]?.label ?? (payRow.status as string)}
              </span>
            </div>

            {receiptUrl ? (
              <ImageLightbox
                src={receiptUrl}
                alt="Reçu de paiement"
                triggerClassName="block w-full overflow-hidden rounded-xl ring-1 ring-border"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={receiptUrl}
                  alt="Reçu de paiement"
                  className="max-h-80 w-full bg-surface-2 object-contain"
                />
              </ImageLightbox>
            ) : payRow.receipt_url ? (
              <a
                href={`/api/payments`}
                className="text-[12px] text-gold-bright underline"
              >
                Reçu disponible (ouvrir la file de paiements)
              </a>
            ) : (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-[12px] text-muted">
                Le vendeur n&apos;a pas encore téléversé de reçu.
              </p>
            )}

            <Link
              href="/admin/payments"
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:text-gold-bright"
            >
              Gérer dans la file de paiements →
            </Link>
          </div>
        )}
      </Card>

      {/* Owner */}
      <Card title="Vendeur">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px]">
          <span className="inline-flex items-center gap-1.5 text-foreground">
            <User className="size-3.5 text-gold" />
            {owner?.full_name ?? "—"}
          </span>
          {owner?.phone && (
            <a
              href={`tel:${owner.phone}`}
              className="inline-flex items-center gap-1.5 text-foreground hover:text-gold-bright"
            >
              <Phone className="size-3.5 text-gold" />
              {owner.phone}
            </a>
          )}
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl bg-surface p-4 ring-1 ring-border">
      <h2 className="batta-eyebrow mb-3 flex items-center gap-2">
        <span aria-hidden className="batta-gold-rule-short" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3 ring-1 ring-border">
      <div className="truncate text-[9px] font-extrabold uppercase tracking-[0.16em] text-muted">
        {label}
      </div>
      <div className="batta-tabular mt-0.5 truncate text-[14px] font-bold text-foreground">
        {value}
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-border py-6 text-muted">
      {icon}
      <span className="text-[12px]">{text}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "ready" ? "batta-tone-ok"
    : status === "pending_review" ? "batta-tone-warn"
    : status === "rejected" ? "batta-tone-bad"
    : "bg-surface-2 text-muted ring-1 ring-border";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
      {status}
    </span>
  );
}
