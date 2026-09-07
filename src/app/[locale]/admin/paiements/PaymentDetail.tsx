"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { ReceiptPreview } from "@/components/admin/ReceiptPreview";
import { AdminButton } from "@/components/admin/AdminButton";
import {
  StatusPill, Confirm, useAdminAction, paymentKindLabel, EYEBROW,
} from "@/components/admin/kit";
import { formatTND } from "@/lib/utils";
import { Check, X, ChevronLeft, ExternalLink, FileWarning } from "lucide-react";

/**
 * The right pane: one receipt, and the decision.
 *
 * The whole job is "does this piece of paper match this amount?", so the
 * receipt is the first and largest thing in the pane — not a thumbnail behind
 * a link, which is what the old flow gave you before sending you to a
 * separate page to type a rejection reason.
 */

export type PaymentDetailData = {
  id: string;
  kind: string;
  status: string;
  amount: number;
  provider: string;
  createdAt: string;
  uploadedAt: string | null;
  reviewedAt: string | null;
  adminNotes: string | null;
  sellerName: string;
  sellerPhone: string | null;
  productName: string | null;
  /** The annonce this fee buys, when there is one. */
  listing: { id: string; title: string; status: string } | null;
  /** Signed URLs + their storage paths, so the preview knows the real type. */
  receipts: { url: string; path: string }[];
};

const dt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("fr-FR", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

const PROVIDER_LABEL: Record<string, string> = {
  bank_transfer: "Virement bancaire",
  d17: "D17",
  manual: "Espèces / manuel",
  konnect: "Konnect",
  paymee: "Paymee",
  flouci: "Flouci",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_1fr] gap-3 py-[5px]">
      <dt className="text-[11.5px] text-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-[12.5px] text-foreground">{children}</dd>
    </div>
  );
}

export function PaymentDetail({
  payment,
  backHref,
}: {
  payment: PaymentDetailData;
  backHref: string;
}) {
  const { run, pending } = useAdminAction();
  const [confirm, setConfirm] = useState<null | "accept" | "reject">(null);
  const p = payment;

  const open = p.status === "pending" || p.status === "pending_review";

  const act = (body: Record<string, unknown>, success: string) =>
    run({ url: `/api/admin/paiements/${p.id}`, method: "POST", body, success });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-5 py-3.5">
        <Link
          href={backHref as "/admin/paiements"}
          className="mb-2 inline-flex items-center gap-1 text-[12px] font-medium text-subtle transition hover:text-foreground lg:hidden"
        >
          <ChevronLeft className="size-3.5" strokeWidth={2.4} />
          File
        </Link>
        <div className="flex items-baseline gap-3">
          <h1 className="batta-tabular text-[19px] font-semibold tracking-tight text-foreground">
            {formatTND(p.amount, "fr")} TND
          </h1>
          <StatusPill status={p.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-subtle">
          <span>{paymentKindLabel(p.kind)}</span>
          <span>{PROVIDER_LABEL[p.provider] ?? p.provider}</span>
          <span>{p.sellerName}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {p.receipts.length > 0 ? (
          <div className="space-y-3">
            {p.receipts.map((r, i) => (
              <ReceiptPreview
                key={r.path}
                url={r.url}
                path={r.path}
                label={p.receipts.length > 1 ? `Reçu ${i + 1}` : "Reçu"}
                triggerClassName="relative block max-h-[420px] w-full overflow-hidden border border-border bg-surface-2 hover:border-[var(--gold-soft)]"
                imgClassName="max-h-[420px] w-full object-contain"
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 border border-dashed border-border px-4 py-5 text-[12.5px] text-[var(--tone-warn)]">
            <FileWarning className="size-4 shrink-0" strokeWidth={2.2} />
            Aucun reçu n'a été envoyé pour ce paiement.
          </div>
        )}

        {p.adminNotes && (
          <p className="mt-4 border-s-2 border-[var(--tone-bad)] ps-3 text-[12.5px] text-[var(--tone-bad)]">
            <span className="font-semibold">Motif du refus :</span> {p.adminNotes}
          </p>
        )}

        <section className="mt-6 border-t border-border pt-4">
          <h2 className={EYEBROW}>Le paiement</h2>
          <dl className="mt-2">
            <Row label="Montant">
              <span className="batta-tabular">{formatTND(p.amount, "fr")} TND</span>
            </Row>
            <Row label="Pour">{p.productName ?? paymentKindLabel(p.kind)}</Row>
            <Row label="Méthode">{PROVIDER_LABEL[p.provider] ?? p.provider}</Row>
            <Row label="Initié le">{dt(p.createdAt)}</Row>
            <Row label="Reçu envoyé le">{dt(p.uploadedAt)}</Row>
            {p.reviewedAt && <Row label="Traité le">{dt(p.reviewedAt)}</Row>}
          </dl>
        </section>

        <section className="mt-5 border-t border-border pt-4">
          <h2 className={EYEBROW}>Vendeur</h2>
          <dl className="mt-2">
            <Row label="Nom">{p.sellerName}</Row>
            {p.sellerPhone && <Row label="Téléphone">{p.sellerPhone}</Row>}
          </dl>
        </section>

        {p.listing && (
          <section className="mt-5 border-t border-border pt-4">
            <h2 className={EYEBROW}>Annonce concernée</h2>
            <dl className="mt-2">
              <Row label="Titre">
                <Link
                  href={`/admin/annonces?status=all&a=${p.listing.id}` as "/admin/annonces"}
                  className="inline-flex items-center gap-1.5 font-medium text-[var(--gold)] hover:underline"
                >
                  {p.listing.title} <ExternalLink className="size-3" strokeWidth={2.2} />
                </Link>
              </Row>
              <Row label="Statut">
                <StatusPill status={p.listing.status} />
              </Row>
            </dl>
            {open && (
              <p className="mt-2 text-[11.5px] text-subtle">
                Valider ce reçu fait passer l'annonce en vérification — elle n'est pas publiée
                automatiquement.
              </p>
            )}
          </section>
        )}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-5 py-3">
        {open ? (
          <>
            <AdminButton
              variant="primary"
              pending={pending}
              icon={<Check className="size-3.5" strokeWidth={2.8} />}
              onClick={() => setConfirm("accept")}
            >
              Valider le reçu
            </AdminButton>
            <AdminButton
              variant="danger"
              icon={<X className="size-3.5" strokeWidth={2.6} />}
              onClick={() => setConfirm("reject")}
            >
              Refuser
            </AdminButton>
          </>
        ) : (
          <span className="text-[12px] text-subtle">
            Déjà traité — plus rien à décider ici.
          </span>
        )}
      </footer>

      <Confirm
        open={confirm === "accept"}
        title={`Valider ${formatTND(p.amount, "fr")} TND ?`}
        body={
          p.listing
            ? "Le paiement est encaissé et l'annonce part en vérification."
            : "Le paiement est encaissé et ce que le vendeur a acheté lui est accordé."
        }
        confirmLabel="Valider"
        variant="primary"
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (await act({ action: "accept" }, "Reçu validé.")) setConfirm(null);
        }}
      />
      <Confirm
        open={confirm === "reject"}
        title="Refuser ce reçu ?"
        body="Le vendeur reçoit le motif et peut en envoyer un autre."
        confirmLabel="Refuser"
        pending={pending}
        reason={{
          label: "Motif (envoyé au vendeur)",
          placeholder: "Montant différent, reçu illisible, virement introuvable…",
          required: true,
        }}
        onCancel={() => setConfirm(null)}
        onConfirm={async (reason) => {
          if (await act({ action: "reject", reason }, "Reçu refusé.")) setConfirm(null);
        }}
      />
    </div>
  );
}
