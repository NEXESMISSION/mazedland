"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Flag, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";

const REASONS = ["scam", "wrong_info", "sold", "duplicate", "inappropriate", "other"] as const;
type Reason = (typeof REASONS)[number];

/**
 * "Signaler cette annonce". Visitors are the moderators of what the rules let
 * through: three reports from different people take an annonce down until an
 * admin looks (src/app/api/annonces/[id]/report). No sign-in needed — the
 * person who has just been asked for a deposit on a house that does not exist
 * is rarely logged in.
 */
export function ReportListing({ listingId }: { listingId: string }) {
  const t = useTranslations("listing.report");
  const { toast } = useToast();
  const apiError = useApiError();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/annonces/${listingId}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, note: note.trim() || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      setSent(true);
      setOpen(false);
      toast(t("thanks"), "success");
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return <p className="mt-2 text-[12px] font-semibold text-muted">{t("alreadySent")}</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-bold text-muted underline-offset-2 hover:text-foreground hover:underline"
      >
        <Flag className="size-3.5" />
        {t("open")}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t("title")} description={t("description")}>
        <fieldset className="space-y-2">
          <legend className="sr-only">{t("reasonLegend")}</legend>
          {REASONS.map((r) => (
            <label
              key={r}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-[13px] transition ${
                reason === r ? "border-foreground bg-surface-2" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="size-4 accent-[var(--gold)]"
              />
              {t(`reasons.${r}`)}
            </label>
          ))}
        </fieldset>

        <label className="mt-4 block">
          <span className="text-[12px] font-semibold text-muted">{t("noteLabel")}</span>
          <textarea
            rows={3}
            maxLength={500}
            dir="auto"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="mazed-input mt-1 resize-y py-2"
          />
        </label>

        <button
          type="button"
          onClick={submit}
          disabled={!reason || busy}
          className="mazed-btn-luxe tap-target mt-5 inline-flex w-full items-center justify-center gap-2 px-5 py-3 text-[13.5px] disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("send")}
        </button>
      </Modal>
    </>
  );
}
