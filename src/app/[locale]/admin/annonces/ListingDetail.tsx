"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  StatusPill, Confirm, TextField, TextareaField, NumberField,
  ToggleField, FieldGrid, useAdminAction, paymentKindText, EYEBROW,
} from "@/components/admin/kit";
import { Ltr } from "@/components/ui/Ltr";
import { formatDate, formatTND } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import {
  Check, X, Archive, Trash2, CalendarPlus, BadgeCheck,
  Pencil, RotateCcw, ExternalLink, ImageOff, ChevronLeft,
} from "lucide-react";

/**
 * The right pane: one annonce, everything about it, and everything you can do
 * to it.
 *
 * It is a pane, not a drawer. A drawer covers the list it came from, so every
 * decision costs an open and a close; a permanent second pane means the queue
 * stays visible and moderating twenty annonces is twenty clicks rather than
 * forty. Below `lg` there is no room for two, so the list hands over full-width
 * and a back link returns.
 *
 * Three things Auto's version has and this does not, because Land's schema
 * does not carry them: `condition` (neuf/occasion does not describe a
 * building), the home-page feature action (`featured_rank` / `featured_until`
 * are Auto columns; Land curates its home page from its own screen), and the
 * Diagnostic Mazed sheet (`vehicle_diagnostics` is an Auto table).
 */

export type PanelPhoto = { path: string; isCover: boolean };

export type PanelListing = {
  id: string;
  title: string;
  description: string | null;
  price: number | null;
  negotiable: boolean;
  priceOnRequest: boolean;
  governorate: string;
  delegation: string | null;
  status: string;
  rejectionReason: string | null;
  /** Already in the page's language (categoryLabel). */
  categoryLabel: string;
  categoryKind: string;
  sellerName: string;
  sellerPhone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  showPhone: boolean;
  /** Resolved server-side against `category_attributes`, so labels are real. */
  attributes: { label: string; value: string }[];
  photos: PanelPhoto[];
  createdAt: string;
  publishedAt: string | null;
  expiresAt: string | null;
  viewCount: number;
  contactRevealCount: number;
  renewedCount: number;
  attestation: { version: string; at: string | null } | null;
  payment: { amount: number; status: string; kind: string; uploadedAt: string | null } | null;
  paidWith: "credit" | "payment" | "waived" | "none";
};

/** `paidWith` is worded by `adminListings.detail.paidWith.<value>`. */
const dt = (iso: string | null, locale: string) => (iso ? formatDate(iso, locale, "medium") : "—");

/** label / value line. No borders — the label column carries the structure. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 py-[5px]">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-foreground">{children}</dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className={EYEBROW}>{title}</h3>
      <dl className="mt-2">{children}</dl>
    </section>
  );
}

export function ListingDetail({
  listing,
  backHref,
}: {
  listing: PanelListing;
  backHref: string;
}) {
  const { run, pending } = useAdminAction();
  const t = useTranslations("adminListings.detail");
  const tListings = useTranslations("adminListings");
  const tAdmin = useTranslations("admin");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const [confirm, setConfirm] = useState<null | "reject" | "delete" | "archive" | "sold">(null);
  const [editing, setEditing] = useState(false);

  const l = listing;
  const feeUnsettled =
    l.status === "pending_payment" || (l.status === "pending_review" && l.paidWith === "none");

  const act = (body: Record<string, unknown>, success: string) =>
    run({ url: `/api/admin/annonces/${l.id}`, method: "POST", body, success });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <Link
          href={backHref as "/admin/annonces"}
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
          {t("back")}
        </Link>
        <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
          {l.title}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
          <StatusPill status={l.status} />
          <span>{l.categoryLabel}</span>
          <span>
            {governorateLabel(l.governorate, locale)}
            {l.delegation ? ` · ${l.delegation}` : ""}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {l.photos.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {l.photos.map((p, i) => (
              <div
                key={`${p.path}-${i}`}
                className="relative aspect-[4/3] w-[150px] shrink-0 overflow-hidden bg-surface-2"
              >
                {/* A plain <img>: these are admin-only thumbnails behind auth,
                    so the optimizer buys nothing and adds a failure mode. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={propertyPhotoUrl(p.path, { transform: { width: 300, quality: 60 } })}
                  alt={t("photoAlt", { n: i + 1 })}
                  className="size-full object-cover"
                />
                {p.isCover && (
                  <span className="absolute start-1 top-1 bg-black/70 px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white">
                    {t("cover")}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 border border-dashed border-border px-4 py-5 text-[12px] text-subtle">
            <ImageOff className="size-4" strokeWidth={2} />
            {t("noPhotos")}
          </div>
        )}

        {l.rejectionReason && (
          <p className="mt-4 border-s-2 border-[var(--tone-bad)] ps-3 text-[12.5px] text-[var(--tone-bad)]">
            <span className="font-semibold">{t("rejectionReason")}</span> {l.rejectionReason}
          </p>
        )}

        {editing && <EditForm listing={l} onDone={() => setEditing(false)} />}

        <div className="mt-5 space-y-4">
          <Group title={t("groupListing")}>
            <Row label={t("price")}>
              {l.priceOnRequest
                ? tListings("priceOnRequest")
                : l.price != null
                  ? `${formatTND(l.price, locale)} ${tCommon("tnd")}${l.negotiable ? ` · ${t("negotiable")}` : ""}`
                  : "—"}
            </Row>
            {l.description && (
              <Row label={t("description")}>
                <span className="whitespace-pre-wrap">{l.description}</span>
              </Row>
            )}
          </Group>

          {l.attributes.length > 0 && (
            <Group title={t("groupAttributes")}>
              {l.attributes.map((a) => (
                <Row key={a.label} label={a.label}>
                  {a.value}
                </Row>
              ))}
            </Group>
          )}

          <Group title={t("groupSeller")}>
            <Row label={t("account")}>{l.sellerName}</Row>
            {l.sellerPhone && (
              <Row label={t("accountPhone")}>
                <Ltr>{l.sellerPhone}</Ltr>
              </Row>
            )}
            <Row label={t("onListing")}>
              {l.contactPhone ? (
                <>
                  <Ltr>{l.contactPhone}</Ltr>
                  {l.contactName ? ` · ${l.contactName}` : ""}
                  {!l.showPhone && <span className="text-subtle"> {t("phoneHidden")}</span>}
                </>
              ) : (
                <span className="text-[var(--tone-bad)]">{t("noPhone")}</span>
              )}
            </Row>
            {l.attestation && (
              <Row label={t("attestation")}>
                {l.attestation.version === "v1-admin"
                  ? t("attestationAdmin")
                  : t("attestationSeller")}
                {l.attestation.at ? ` · ${dt(l.attestation.at, locale)}` : ""}
              </Row>
            )}
          </Group>

          <Group title={t("groupPublication")}>
            <Row label={t("paidBy")}>{t(`paidWith.${l.paidWith}`)}</Row>
            {l.payment && (
              <Row label={t("payment")}>
                {formatTND(l.payment.amount, locale)} {tCommon("tnd")} ·{" "}
                {paymentKindText(tAdmin, l.payment.kind)} ·{" "}
                <StatusPill status={l.payment.status} />
              </Row>
            )}
            <Row label={t("createdAt")}>{dt(l.createdAt, locale)}</Row>
            <Row label={t("publishedAt")}>{dt(l.publishedAt, locale)}</Row>
            <Row label={t("expiresAt")}>{dt(l.expiresAt, locale)}</Row>
            <Row label={t("renewals")}>{l.renewedCount}</Row>
            <Row label={t("audience")}>
              {t("audienceValue", { views: l.viewCount, reveals: l.contactRevealCount })}
            </Row>
            {l.status === "published" && (
              <Row label={t("publicPage")}>
                <Link
                  href={`/annonces/${l.id}` as "/annonces"}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 font-medium text-[var(--gold)] hover:underline"
                >
                  {t("open")} <ExternalLink className="size-3" strokeWidth={2.2} />
                </Link>
              </Row>
            )}
          </Group>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        {l.status === "pending_review" && (
          <>
            <AdminButton
              variant="primary"
              pending={pending}
              icon={<Check className="size-3.5" strokeWidth={2.8} />}
              onClick={() => act({ action: "approve" }, t("approved"))}
            >
              {t("publish")}
            </AdminButton>
            <AdminButton
              variant="danger"
              icon={<X className="size-3.5" strokeWidth={2.6} />}
              onClick={() => setConfirm("reject")}
            >
              {t("reject")}
            </AdminButton>
          </>
        )}

        {feeUnsettled && (
          <>
            {l.payment && (
              <AdminButton
                pending={pending}
                onClick={() => act({ action: "mark_paid" }, t("paymentRecorded"))}
              >
                {t("markPaid")}
              </AdminButton>
            )}
            <AdminButton
              pending={pending}
              onClick={() => act({ action: "waive_fee" }, t("feeWaived"))}
            >
              {t("waive")}
            </AdminButton>
          </>
        )}

        {l.status === "published" && (
          <>
            <AdminButton
              pending={pending}
              icon={<CalendarPlus className="size-3.5" strokeWidth={2.4} />}
              onClick={() => act({ action: "extend", days: 30 }, t("extended"))}
            >
              {t("extend30")}
            </AdminButton>
            <AdminButton
              icon={<BadgeCheck className="size-3.5" strokeWidth={2.4} />}
              onClick={() => setConfirm("sold")}
            >
              {t("sold")}
            </AdminButton>
          </>
        )}

        {(l.status === "expired" || l.status === "archived" || l.status === "rejected") && (
          <AdminButton
            variant="primary"
            pending={pending}
            icon={<RotateCcw className="size-3.5" strokeWidth={2.4} />}
            onClick={() => act({ action: "republish" }, t("republished"))}
          >
            {t("republish")}
          </AdminButton>
        )}

        <AdminButton
          variant="quiet"
          icon={<Pencil className="size-3.5" strokeWidth={2.4} />}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? t("close") : t("edit")}
        </AdminButton>

        {l.status !== "archived" && (
          <AdminButton
            variant="quiet"
            icon={<Archive className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirm("archive")}
          >
            {t("archive")}
          </AdminButton>
        )}

        <AdminButton
          variant="quiet"
          className="ms-auto"
          icon={<Trash2 className="size-3.5" strokeWidth={2.4} />}
          onClick={() => setConfirm("delete")}
        >
          {t("delete")}
        </AdminButton>
      </footer>

      <Confirm
        open={confirm === "reject"}
        title={t("rejectTitle")}
        body={t("rejectBody")}
        confirmLabel={t("reject")}
        pending={pending}
        reason={{
          label: t("rejectReasonLabel"),
          placeholder: t("rejectReasonPlaceholder"),
          required: true,
        }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "reject", reason }, t("rejected"))) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "archive"}
        title={t("archiveTitle")}
        body={t("archiveBody")}
        confirmLabel={t("archive")}
        variant="default"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "archive" }, t("archived"))) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "sold"}
        title={t("soldTitle")}
        body={t("soldBody")}
        confirmLabel={t("soldConfirm")}
        variant="primary"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "mark_sold" }, t("markedSold"))) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "delete"}
        title={t("deleteTitle")}
        body={t("deleteBody")}
        confirmLabel={t("delete")}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "delete" }, t("deleted"))) setConfirm(null);
        }}
      />
    </div>
  );
}

/**
 * The corrections a moderator actually makes — a price with a zero too many, a
 * title in capitals, a wrong number. Category and attributes are absent on
 * purpose: those change what the annonce *is*, and belong in the seller's own
 * form rather than in a moderation pane.
 */
function EditForm({ listing, onDone }: { listing: PanelListing; onDone: () => void }) {
  const { run, pending } = useAdminAction();
  const t = useTranslations("adminListings.detail");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState(listing.title);
  const [price, setPrice] = useState<number | null>(listing.price);
  const [negotiable, setNegotiable] = useState(listing.negotiable);
  const [onRequest, setOnRequest] = useState(listing.priceOnRequest);
  const [phone, setPhone] = useState(listing.contactPhone ?? "");
  const [name, setName] = useState(listing.contactName ?? "");
  const [description, setDescription] = useState(listing.description ?? "");

  async function save() {
    const ok = await run({
      url: `/api/admin/annonces/${listing.id}`,
      method: "POST",
      body: {
        action: "edit",
        fields: {
          title,
          price: onRequest ? null : price,
          negotiable,
          price_on_request: onRequest,
          contact_phone: phone,
          contact_name: name,
          description,
        },
      },
      success: t("edited"),
    });
    if (ok) onDone();
  }

  return (
    <div className="mt-4 border-s-2 border-[var(--gold)] ps-4">
      <h3 className={`${EYEBROW} text-[var(--gold)]`}>{t("editTitle")}</h3>
      <div className="mt-3 space-y-3.5">
        <TextField label={t("fieldTitle")} value={title} onChange={setTitle} required />
        <FieldGrid>
          <NumberField
            label={t("fieldPrice")}
            value={price}
            onChange={setPrice}
            min={0}
            suffix={tCommon("tnd")}
            disabled={onRequest}
            hint={onRequest ? t("priceDisabled") : undefined}
          />
          <div className="flex flex-col justify-center gap-2.5 pt-2">
            <ToggleField label={t("fieldNegotiable")} checked={negotiable} onChange={setNegotiable} />
            <ToggleField label={t("fieldPriceOnRequest")} checked={onRequest} onChange={setOnRequest} />
          </div>
        </FieldGrid>
        <FieldGrid>
          <TextField label={t("fieldPhone")} value={phone} onChange={setPhone} type="tel" />
          <TextField label={t("fieldName")} value={name} onChange={setName} />
        </FieldGrid>
        <TextareaField label={t("fieldDescription")} value={description} onChange={setDescription} rows={4} />
        <div className="flex justify-end gap-2">
          <AdminButton variant="quiet" onClick={onDone}>
            {t("cancel")}
          </AdminButton>
          <AdminButton variant="primary" pending={pending} onClick={save}>
            {t("save")}
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
