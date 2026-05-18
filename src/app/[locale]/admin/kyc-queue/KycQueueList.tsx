"use client";

import { useState } from "react";
import { Check, X, ImageIcon, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

const DEFAULT_REJECT_REASON =
  "Photo de la CIN illisible — reprenez avec un meilleur éclairage.";

export interface KycSubmissionView {
  id: string;
  user_id: string;
  full_name: string | null;
  status: string;
  rejection_reason: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  // All four are signed URLs (or null) when this component renders.
  id_front_url: string | null;
  id_back_url: string | null;
  selfie_video_url: string | null;
  selfie_image_url: string | null;
}

const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|ogv|ogg)(\?|#|$)/i;
function isVideoUrl(url: string): boolean {
  return VIDEO_EXT_RE.test(url);
}

export function KycQueueList({
  items: initialItems,
  view,
}: {
  items: KycSubmissionView[];
  view: string;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState(initialItems);
  // Tracks which submission is currently being approved/rejected so we
  // can disable both buttons without locking the whole list.
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<KycSubmissionView | null>(null);
  const [rejectReason, setRejectReason] = useState(DEFAULT_REJECT_REASON);

  // The "submitted" tab is the only actionable view; archive tabs are
  // read-only. Mazed-auto has bulk-select on top of this; we keep the
  // single-row review pattern since the volume is low.
  const actionable = view === "submitted";

  async function decide(
    sub: KycSubmissionView,
    decision: "verified" | "rejected",
    reason?: string,
  ) {
    if (busy) return;
    setBusy(sub.id);
    try {
      const res = await fetch(`/api/admin/kyc/${sub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verdict: decision,
          notes: reason ?? "",
          user_id: sub.user_id,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(
          `Erreur : ${json?.error ?? res.status}`,
          "error",
        );
        return;
      }
      // Optimistically remove from the queue — the archive view will
      // pick up the row on next refresh.
      setItems((arr) => arr.filter((i) => i.id !== sub.id));
      toast(
        decision === "verified"
          ? "Soumission approuvée — l'utilisateur est notifié."
          : "Soumission rejetée — l'utilisateur est notifié.",
        decision === "verified" ? "success" : "warning",
      );
    } finally {
      setBusy(null);
      setRejecting(null);
      setRejectReason(DEFAULT_REJECT_REASON);
    }
  }

  function openReject(sub: KycSubmissionView) {
    setRejectReason(DEFAULT_REJECT_REASON);
    setRejecting(sub);
  }

  function reject(sub: KycSubmissionView) {
    openReject(sub);
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <article
          key={item.id}
          className="rounded-xl bg-surface p-4 ring-1 ring-border"
        >
          {/* Header — name + user id + submission timestamp */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold text-foreground">
                {item.full_name || "Sans nom"}
              </div>
              <a
                href={`/admin/users/${item.user_id}`}
                className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-gold hover:underline"
              >
                {item.user_id.slice(0, 8)}…
                <ExternalLink className="size-2.5" />
              </a>
              <div className="mt-1 text-[10px] text-muted">
                Soumis le{" "}
                {new Date(item.submitted_at).toLocaleString("fr-FR")}
                {item.reviewed_at && (
                  <>
                    {" "}
                    · Examiné le{" "}
                    {new Date(item.reviewed_at).toLocaleString("fr-FR")}
                  </>
                )}
              </div>
            </div>
            <StatusBadge status={item.status} />
          </div>

          {/* 2×2 evidence grid — CIN front/back + selfie still + triptych */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <EvidenceTile
              url={item.id_front_url}
              label="CIN recto"
            />
            <EvidenceTile url={item.id_back_url} label="CIN verso" />
            <EvidenceTile
              url={item.selfie_image_url}
              label="Selfie face"
            />
            <EvidenceTile
              url={item.selfie_video_url}
              label="Triptyque"
            />
          </div>

          {item.rejection_reason && (
            <div className="mt-3 rounded-md batta-tone-bad px-3 py-2 text-[11px]">
              <span className="font-bold uppercase tracking-wider">
                Motif de rejet :
              </span>{" "}
              {item.rejection_reason}
            </div>
          )}

          {actionable && (
            <>
              <div aria-hidden className="batta-hairline mt-4" />
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => reject(item)}
                  disabled={busy !== null}
                >
                  {busy === item.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <X className="size-4" />
                  )}
                  Rejeter
                </Button>
                <Button
                  size="sm"
                  onClick={() => decide(item, "verified")}
                  disabled={busy !== null}
                >
                  {busy === item.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Approuver
                </Button>
              </div>
            </>
          )}
        </article>
      ))}

      {/* Reject modal — replaces the old window.prompt */}
      {rejecting && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => !busy && setRejecting(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-foreground">
              Motif du rejet KYC
            </h3>
            <p className="mt-1 text-[12px] text-[var(--foreground-muted)] leading-relaxed">
              L&apos;utilisateur reçoit une notification avec ce message et
              peut relancer la vérification depuis sa page KYC.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              maxLength={500}
              autoFocus
              className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)]/40 p-2.5 text-[13px] font-medium text-foreground placeholder:text-[var(--foreground-muted)] focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/40"
            />
            <div className="mt-1 text-[10px] text-[var(--foreground-muted)] text-end">
              {rejectReason.length} / 500
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy === rejecting.id}
                onClick={() => setRejecting(null)}
                className="flex-1 h-10 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px]"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy === rejecting.id || rejectReason.trim().length < 5}
                onClick={() =>
                  decide(rejecting, "rejected", rejectReason.trim())
                }
                className="flex-1 h-10 rounded-[var(--radius)] bg-red-600 text-white font-bold text-[13px] hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                {busy === rejecting.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" strokeWidth={2.5} />
                )}
                Rejeter et notifier
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "verified"
      ? "batta-tone-ok"
      : status === "rejected"
        ? "batta-tone-bad"
        : "batta-tone-warn";
  const label =
    status === "verified"
      ? "Approuvé"
      : status === "rejected"
        ? "Rejeté"
        : "En attente";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone}`}
    >
      {label}
    </span>
  );
}

function EvidenceTile({
  url,
  label,
}: {
  url: string | null;
  label: string;
}) {
  if (!url) {
    return (
      <div className="aspect-square rounded-lg bg-surface-2 ring-1 ring-border flex flex-col items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-muted">
        <ImageIcon className="size-4" />
        manquant
      </div>
    );
  }
  const video = isVideoUrl(url);
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block aspect-square overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border transition hover:ring-gold/40"
    >
      <div className="relative h-full w-full">
        {video ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={url}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-white">
          {label}
        </div>
      </div>
    </a>
  );
}
