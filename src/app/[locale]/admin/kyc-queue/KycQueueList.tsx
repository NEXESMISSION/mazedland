"use client";

import { useState } from "react";
import { Check, X, ImageIcon, ExternalLink, Loader2, CheckSquare, Square } from "lucide-react";
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

  // ─── Bulk selection (the "submitted" queue can run hundreds deep, so
  //     reviewing them one card at a time doesn't scale). Multi-select +
  //     one approve/reject for the whole selection, looping the existing
  //     per-submission endpoint sequentially. ───
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const bulkBusy = bulkProgress !== null;

  // The "submitted" tab is the only actionable view; archive tabs are
  // read-only.
  const actionable = view === "submitted";

  async function submitDecision(
    sub: KycSubmissionView,
    decision: "verified" | "rejected",
    reason?: string,
  ): Promise<boolean> {
    const res = await fetch(`/api/admin/kyc/${sub.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ verdict: decision, notes: reason ?? "", user_id: sub.user_id }),
    });
    return res.ok;
  }

  async function decide(
    sub: KycSubmissionView,
    decision: "verified" | "rejected",
    reason?: string,
  ) {
    if (busy || bulkBusy) return;
    setBusy(sub.id);
    try {
      const ok = await submitDecision(sub, decision, reason);
      if (!ok) {
        toast("Erreur lors de la décision.", "error");
        return;
      }
      // Optimistically remove from the queue — the archive view will
      // pick up the row on next refresh.
      setItems((arr) => arr.filter((i) => i.id !== sub.id));
      setSelected((s) => {
        if (!s.has(sub.id)) return s;
        const n = new Set(s);
        n.delete(sub.id);
        return n;
      });
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

  async function runBulk(decision: "verified" | "rejected", reason?: string) {
    const targets = items.filter((i) => selected.has(i.id));
    if (targets.length === 0) return;
    setBulkProgress({ done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;
    for (const t of targets) {
      // eslint-disable-next-line no-await-in-loop
      const success = await submitDecision(t, decision, reason);
      if (success) {
        ok += 1;
        setItems((arr) => arr.filter((i) => i.id !== t.id));
      } else {
        fail += 1;
      }
      setBulkProgress({ done: ok + fail, total: targets.length });
    }
    setBulkProgress(null);
    setBulkRejectOpen(false);
    setRejectReason(DEFAULT_REJECT_REASON);
    setSelected(new Set());
    toast(
      `${ok} soumission${ok > 1 ? "s" : ""} ${decision === "verified" ? "approuvée" : "rejetée"}${ok > 1 ? "s" : ""}` +
        (fail > 0 ? ` · ${fail} échec${fail > 1 ? "s" : ""}` : "."),
      fail > 0 ? "warning" : decision === "verified" ? "success" : "warning",
    );
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const allOnPage = items.length > 0 && items.every((i) => selected.has(i.id));
  function toggleAll() {
    setSelected(allOnPage ? new Set() : new Set(items.map((i) => i.id)));
  }

  return (
    <div>
      {/* Bulk select toolbar — only on the actionable queue */}
      {actionable && items.length > 0 && (
        <div className="mb-3 flex items-center gap-3">
          <button
            type="button"
            onClick={toggleAll}
            disabled={bulkBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] font-semibold text-foreground hover:border-gold-soft disabled:opacity-50"
          >
            {allOnPage ? <CheckSquare className="size-4 text-gold" /> : <Square className="size-4 text-muted" />}
            Tout sélectionner
          </button>
          {selected.size > 0 && (
            <span className="batta-tabular text-[12px] text-muted">{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</span>
          )}
        </div>
      )}

      <div className="space-y-3 lg:grid lg:grid-cols-2 lg:gap-3 lg:space-y-0 xl:grid-cols-3">
        {items.map((item) => {
          const checked = selected.has(item.id);
          return (
            <article
              key={item.id}
              className={`rounded-xl bg-surface p-4 ring-1 transition ${checked ? "ring-gold" : "ring-border"}`}
            >
              {/* Header — name + user id + submission timestamp */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  {actionable && (
                    <button
                      type="button"
                      aria-label={checked ? "Désélectionner" : "Sélectionner"}
                      onClick={() => toggle(item.id)}
                      disabled={bulkBusy}
                      className="mt-0.5 shrink-0 disabled:opacity-50"
                    >
                      {checked ? <CheckSquare className="size-4 text-gold" /> : <Square className="size-4 text-muted" />}
                    </button>
                  )}
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
                </div>
                <StatusBadge status={item.status} />
              </div>

              {/* 2×2 evidence grid — CIN front/back + selfie still + triptych */}
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <EvidenceTile url={item.id_front_url} label="CIN recto" />
                <EvidenceTile url={item.id_back_url} label="CIN verso" />
                <EvidenceTile url={item.selfie_image_url} label="Selfie face" />
                <EvidenceTile url={item.selfie_video_url} label="Triptyque" />
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
                      onClick={() => { setRejectReason(DEFAULT_REJECT_REASON); setRejecting(item); }}
                      disabled={busy !== null || bulkBusy}
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
                      disabled={busy !== null || bulkBusy}
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
          );
        })}
      </div>

      {/* Sticky bulk-action bar */}
      {actionable && selected.size > 0 && (
        <div className="sticky bottom-4 z-40 mt-4 flex flex-wrap items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_18px_45px_-18px_rgba(0,0,0,0.5)] ring-1 ring-gold-soft/60">
          <span className="text-[13px] font-bold text-foreground">
            {bulkProgress
              ? `Traitement ${bulkProgress.done}/${bulkProgress.total}…`
              : `${selected.size} soumission${selected.size > 1 ? "s" : ""} sélectionnée${selected.size > 1 ? "s" : ""}`}
          </span>
          <div className="ms-auto flex gap-2">
            <Button
              size="sm"
              variant="danger"
              onClick={() => { setRejectReason(DEFAULT_REJECT_REASON); setBulkRejectOpen(true); }}
              disabled={bulkBusy}
            >
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Rejeter ({selected.size})
            </Button>
            <Button
              size="sm"
              onClick={() => runBulk("verified")}
              disabled={bulkBusy}
            >
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Approuver ({selected.size})
            </Button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              disabled={bulkBusy}
              className="rounded-lg px-2.5 text-[12px] font-semibold text-muted hover:text-foreground disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Reject modal — serves single-card reject AND bulk reject */}
      {(rejecting || bulkRejectOpen) && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={() => { if (!busy && !bulkBusy) { setRejecting(null); setBulkRejectOpen(false); } }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[var(--surface)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-bold text-foreground">
              {bulkRejectOpen ? `Rejeter ${selected.size} soumission${selected.size > 1 ? "s" : ""}` : "Motif du rejet KYC"}
            </h3>
            <p className="mt-1 text-[12px] text-[var(--foreground-muted)] leading-relaxed">
              {bulkRejectOpen
                ? "Le même motif sera envoyé à chaque utilisateur sélectionné. Chacun peut relancer sa vérification."
                : "L'utilisateur reçoit une notification avec ce message et peut relancer la vérification depuis sa page KYC."}
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
                disabled={busy !== null || bulkBusy}
                onClick={() => { setRejecting(null); setBulkRejectOpen(false); }}
                className="flex-1 h-10 rounded-[var(--radius)] bg-[var(--surface-2)] border border-[var(--border)] text-foreground font-semibold text-[13px]"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={busy !== null || bulkBusy || rejectReason.trim().length < 5}
                onClick={() => {
                  if (bulkRejectOpen) runBulk("rejected", rejectReason.trim());
                  else if (rejecting) decide(rejecting, "rejected", rejectReason.trim());
                }}
                className="flex-1 h-10 rounded-[var(--radius)] bg-red-600 text-white font-bold text-[13px] hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5"
              >
                {busy !== null || bulkBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" strokeWidth={2.5} />
                )}
                {bulkRejectOpen ? "Rejeter la sélection" : "Rejeter et notifier"}
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
