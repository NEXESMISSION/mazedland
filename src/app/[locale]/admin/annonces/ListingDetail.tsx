"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  StatusPill, Confirm, TextField, TextareaField, NumberField,
  ToggleField, FieldGrid, useAdminAction, paymentKindLabel, EYEBROW,
} from "@/components/admin/kit";
import { formatTND } from "@/lib/utils";
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

const PAID_WITH_LABEL: Record<PanelListing["paidWith"], string> = {
  credit: "Forfait du vendeur",
  payment: "Paiement à l'unité",
  waived: "Offerte par un admin",
  none: "Rien de rattaché",
};

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

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
          <ChevronLeft className="size-3.5" strokeWidth={2.4} />
          File
        </Link>
        <h1 className="truncate text-[16px] font-semibold tracking-tight text-foreground">
          {l.title}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
          <StatusPill status={l.status} />
          <span>{l.categoryLabel}</span>
          <span>
            {l.governorate}
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
                  alt={`Photo ${i + 1}`}
                  className="size-full object-cover"
                />
                {p.isCover && (
                  <span className="absolute start-1 top-1 bg-black/70 px-1 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white">
                    Couv.
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 border border-dashed border-border px-4 py-5 text-[12px] text-subtle">
            <ImageOff className="size-4" strokeWidth={2} />
            Aucune photo — à vérifier avant publication.
          </div>
        )}

        {l.rejectionReason && (
          <p className="mt-4 border-s-2 border-[var(--tone-bad)] ps-3 text-[12.5px] text-[var(--tone-bad)]">
            <span className="font-semibold">Motif du refus :</span> {l.rejectionReason}
          </p>
        )}

        {editing && <EditForm listing={l} onDone={() => setEditing(false)} />}

        <div className="mt-5 space-y-4">
          <Group title="L'annonce">
            <Row label="Prix">
              {l.priceOnRequest
                ? "Sur demande"
                : l.price != null
                  ? `${formatTND(l.price, "fr")} TND${l.negotiable ? " · négociable" : ""}`
                  : "—"}
            </Row>
            {l.description && (
              <Row label="Description">
                <span className="whitespace-pre-wrap">{l.description}</span>
              </Row>
            )}
          </Group>

          {l.attributes.length > 0 && (
            <Group title="Caractéristiques">
              {l.attributes.map((a) => (
                <Row key={a.label} label={a.label}>
                  {a.value}
                </Row>
              ))}
            </Group>
          )}

          <Group title="Vendeur et contact">
            <Row label="Compte">{l.sellerName}</Row>
            {l.sellerPhone && <Row label="Tél. du compte">{l.sellerPhone}</Row>}
            <Row label="Sur l'annonce">
              {l.contactPhone ? (
                <>
                  {l.contactPhone}
                  {l.contactName ? ` · ${l.contactName}` : ""}
                  {!l.showPhone && <span className="text-subtle"> (masqué)</span>}
                </>
              ) : (
                <span className="text-[var(--tone-bad)]">
                  Aucun numéro — publication impossible
                </span>
              )}
            </Row>
            {l.attestation && (
              <Row label="Attestation">
                {l.attestation.version === "v1-admin"
                  ? "Saisie par un admin (v1-admin)"
                  : "Signée par le vendeur (v1)"}
                {l.attestation.at ? ` · ${dt(l.attestation.at)}` : ""}
              </Row>
            )}
          </Group>

          <Group title="Publication">
            <Row label="Payée par">{PAID_WITH_LABEL[l.paidWith]}</Row>
            {l.payment && (
              <Row label="Paiement">
                {formatTND(l.payment.amount, "fr")} TND · {paymentKindLabel(l.payment.kind)} ·{" "}
                <StatusPill status={l.payment.status} />
              </Row>
            )}
            <Row label="Créée le">{dt(l.createdAt)}</Row>
            <Row label="Publiée le">{dt(l.publishedAt)}</Row>
            <Row label="Expire le">{dt(l.expiresAt)}</Row>
            <Row label="Renouvellements">{l.renewedCount}</Row>
            <Row label="Audience">
              {l.viewCount} vues · {l.contactRevealCount} numéros affichés
            </Row>
            {l.status === "published" && (
              <Row label="Page publique">
                <Link
                  href={`/annonces/${l.id}` as "/annonces"}
                  target="_blank"
                  className="inline-flex items-center gap-1.5 font-medium text-[var(--gold)] hover:underline"
                >
                  Ouvrir <ExternalLink className="size-3" strokeWidth={2.2} />
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
              onClick={() => act({ action: "approve" }, "Annonce publiée.")}
            >
              Publier
            </AdminButton>
            <AdminButton
              variant="danger"
              icon={<X className="size-3.5" strokeWidth={2.6} />}
              onClick={() => setConfirm("reject")}
            >
              Refuser
            </AdminButton>
          </>
        )}

        {feeUnsettled && (
          <>
            {l.payment && (
              <AdminButton
                pending={pending}
                onClick={() => act({ action: "mark_paid" }, "Paiement enregistré.")}
              >
                Marquer payée
              </AdminButton>
            )}
            <AdminButton
              pending={pending}
              onClick={() => act({ action: "waive_fee" }, "Publication offerte.")}
            >
              Offrir
            </AdminButton>
          </>
        )}

        {l.status === "published" && (
          <>
            <AdminButton
              pending={pending}
              icon={<CalendarPlus className="size-3.5" strokeWidth={2.4} />}
              onClick={() => act({ action: "extend", days: 30 }, "Prolongée de 30 jours.")}
            >
              +30 j
            </AdminButton>
            <AdminButton
              icon={<BadgeCheck className="size-3.5" strokeWidth={2.4} />}
              onClick={() => setConfirm("sold")}
            >
              Vendue
            </AdminButton>
          </>
        )}

        {(l.status === "expired" || l.status === "archived" || l.status === "rejected") && (
          <AdminButton
            variant="primary"
            pending={pending}
            icon={<RotateCcw className="size-3.5" strokeWidth={2.4} />}
            onClick={() => act({ action: "republish" }, "Remise en ligne.")}
          >
            Remettre en ligne
          </AdminButton>
        )}

        <AdminButton
          variant="quiet"
          icon={<Pencil className="size-3.5" strokeWidth={2.4} />}
          onClick={() => setEditing((v) => !v)}
        >
          {editing ? "Fermer" : "Modifier"}
        </AdminButton>

        {l.status !== "archived" && (
          <AdminButton
            variant="quiet"
            icon={<Archive className="size-3.5" strokeWidth={2.4} />}
            onClick={() => setConfirm("archive")}
          >
            Archiver
          </AdminButton>
        )}

        <AdminButton
          variant="quiet"
          className="ms-auto"
          icon={<Trash2 className="size-3.5" strokeWidth={2.4} />}
          onClick={() => setConfirm("delete")}
        >
          Supprimer
        </AdminButton>
      </footer>

      <Confirm
        open={confirm === "reject"}
        title="Refuser cette annonce ?"
        body="Le vendeur reçoit le motif et peut corriger son annonce."
        confirmLabel="Refuser"
        pending={pending}
        reason={{
          label: "Motif (envoyé au vendeur)",
          placeholder: "Photos floues, prix incohérent, doublon…",
          required: true,
        }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "reject", reason }, "Annonce refusée.")) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "archive"}
        title="Archiver cette annonce ?"
        body="Elle disparaît du site. Rien n'est remboursé, et vous pourrez la remettre en ligne."
        confirmLabel="Archiver"
        variant="default"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "archive" }, "Annonce archivée.")) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "sold"}
        title="Marquer vendue ?"
        body="L'annonce quitte le catalogue mais reste dans l'historique du vendeur."
        confirmLabel="Marquer vendue"
        variant="primary"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "mark_sold" }, "Marquée vendue.")) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "delete"}
        title="Supprimer définitivement ?"
        body="Irréversible. Une annonce en ligne ou déjà payée ne peut pas être supprimée — archivez-la."
        confirmLabel="Supprimer"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "delete" }, "Annonce supprimée.")) setConfirm(null);
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
      success: "Annonce modifiée.",
    });
    if (ok) onDone();
  }

  return (
    <div className="mt-4 border-s-2 border-[var(--gold)] ps-4">
      <h3 className={`${EYEBROW} text-[var(--gold)]`}>Modifier</h3>
      <div className="mt-3 space-y-3.5">
        <TextField label="Titre" value={title} onChange={setTitle} required />
        <FieldGrid>
          <NumberField
            label="Prix"
            value={price}
            onChange={setPrice}
            min={0}
            suffix="TND"
            disabled={onRequest}
            hint={onRequest ? "Désactivé : prix sur demande" : undefined}
          />
          <div className="flex flex-col justify-center gap-2.5 pt-2">
            <ToggleField label="Négociable" checked={negotiable} onChange={setNegotiable} />
            <ToggleField label="Prix sur demande" checked={onRequest} onChange={setOnRequest} />
          </div>
        </FieldGrid>
        <FieldGrid>
          <TextField label="Téléphone affiché" value={phone} onChange={setPhone} type="tel" />
          <TextField label="Nom affiché" value={name} onChange={setName} />
        </FieldGrid>
        <TextareaField label="Description" value={description} onChange={setDescription} rows={4} />
        <div className="flex justify-end gap-2">
          <AdminButton variant="quiet" onClick={onDone}>
            Annuler
          </AdminButton>
          <AdminButton variant="primary" pending={pending} onClick={save}>
            Enregistrer
          </AdminButton>
        </div>
      </div>
    </div>
  );
}
