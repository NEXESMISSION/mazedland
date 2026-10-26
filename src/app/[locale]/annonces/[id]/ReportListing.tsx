"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Flag, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { useSetting } from "@/components/settings/SettingsProvider";
import { chipClass } from "@/lib/chips";

const REASONS = ["scam", "wrong_info", "sold", "duplicate", "inappropriate", "other"] as const;
type Reason = (typeof REASONS)[number];

/**
 * "Signaler cette annonce". Visitors are the moderators of what the rules let
 * through: a few reports from different people (the threshold set in
 * /admin/settings) take an annonce down until an admin looks
 * (src/app/api/annonces/[id]/report). No sign-in needed — the person who has
 * just been asked for a deposit on a house that does not exist is rarely
 * logged in. Gone entirely when an admin switches reports off.
 *
 * A reason is one tap on a short chip, read back in full under the chips; a
 * text is asked for « Autre » only, where the chip alone says nothing.
 */
export function ReportListing({ listingId }: { listingId: string }) {
  const t = useTranslations("listing.report");
  const { toast } = useToast();
  const apiError = useApiError();
  const enabled = useSetting("feature_reports");
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
        // The text goes with « Autre » only: the other chips say it already.
        body: JSON.stringify({ reason, note: (reason === "other" && note.trim()) || undefined }),
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

  if (!enabled) return null;
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
        <div role="radiogroup" aria-label={t("reasonLegend")} className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              onClick={() => setReason(r)}
              className={chipClass(reason === r)}
            >
              {t(`chips.${r}`)}
            </button>
          ))}
        </div>
        {reason && reason !== "other" && (
          <p className="mt-3 text-[12.5px] leading-snug text-muted">{t(`reasons.${reason}`)}</p>
        )}

        {reason === "other" && (
          <label className="mt-4 block">
            <span className="text-[12px] font-semibold text-muted">{t("noteLabel")}</span>
            <textarea
              rows={3}
              maxLength={500}
              dir="auto"
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              className="mazed-input mt-1 resize-y py-2"
            />
          </label>
        )}

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
