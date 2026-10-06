"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Trash2, AlertTriangle } from "lucide-react";

/**
 * Account self-deletion (GDPR erasure). Two-step + typed confirmation so a
 * destructive, irreversible action can't be a single accidental tap.
 *
 * Server side (POST /api/account/delete) refuses while money is in flight
 * and returns { blockers } — we surface each as a toast so the user knows
 * exactly what to settle first (prefer toasts over inline error blocks).
 */
/**
 * The two things `request_account_deletion` actually refuses on (0153). The
 * other two it used to list — an auction won but unpaid, a payout in flight —
 * went with the auction product, and `active_listings` no longer means "a lot
 * is live": it means an annonce is sitting in the moderation queue.
 *
 * Their sentences are `account.deleteAccount.blockers.<code>`.
 */
const BLOCKERS = new Set(["active_listings", "pending_payments"]);

export function DeleteAccountButton({ label }: { label: string }) {
  const t = useTranslations("account.deleteAccount");
  const locale = useLocale();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, start] = useTransition();
  // « SUPPRIMER » on /fr; on /ar a word typed in Arabic, not a French one.
  const CONFIRM_WORD = t("confirmWord");

  function onDelete() {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) return;
    start(async () => {
      try {
        const res = await fetch("/api/account/delete", {
          method: "POST",
          headers: { Accept: "application/json" },
        });

        if (res.status === 409) {
          const body = (await res.json().catch(() => ({}))) as {
            blockers?: string[];
          };
          const blockers = body.blockers ?? [];
          if (blockers.length === 0) {
            toast(t("impossible"), "warning");
          } else {
            blockers.forEach((b) =>
              toast(BLOCKERS.has(b) ? t(`blockers.${b}`) : t("blockerUnknown"), "warning"),
            );
          }
          return;
        }

        if (!res.ok) {
          toast(t("failed"), "error");
          return;
        }

        // Success — drop the local session and hard-navigate home.
        try {
          await getBrowserSupabase().auth.signOut();
        } catch {
          /* already signed out server-side */
        }
        toast(t("deleted"), "success");
        // A full reload, not a router push: the session is gone, and every
        // in-memory store on the page (favourites, popups, notifications) still
        // describes the deleted account. A soft navigation would keep them.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops the deleted account's client state
        window.location.assign(`/${locale}`);
      } catch {
        toast(t("networkError"), "error");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target w-full px-5 py-3 text-[13px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-xl transition-colors inline-flex items-center justify-center gap-2"
      >
        <Trash2 className="size-4" strokeWidth={2} />
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger)]/[0.06] p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="size-5 shrink-0 text-[var(--danger)]" strokeWidth={2} />
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-foreground">
            {t("confirmTitle")}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {t.rich("confirmBody", {
              word: CONFIRM_WORD,
              strong: (chunks) => <span className="font-bold text-[var(--danger)]">{chunks}</span>,
            })}
          </p>
        </div>
      </div>

      <input
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={CONFIRM_WORD}
        autoComplete="off"
        autoCapitalize="characters"
        className="mt-3 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-[14px] text-foreground outline-none focus:border-[var(--danger)]"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmText("");
          }}
          disabled={pending}
          className="mazed-btn-ghost-gold tap-target flex-1 px-4 py-2.5 text-[13px] disabled:opacity-50"
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending || confirmText.trim().toUpperCase() !== CONFIRM_WORD}
          className="tap-target flex-1 rounded-xl bg-[var(--danger)] px-4 py-2.5 text-[13px] font-bold text-white transition-opacity disabled:opacity-40"
        >
          {pending ? t("deleting") : t("delete")}
        </button>
      </div>
    </div>
  );
}
