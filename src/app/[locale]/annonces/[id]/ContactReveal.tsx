"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { Ltr } from "@/components/ui/Ltr";
import { Phone, MessageCircle, Loader2 } from "lucide-react";
import { recordSocialContact, recordSocialVisit } from "@/lib/social/visit";

export type RevealedContact = { phone: string; whatsapp: string | null };

// The number once asked for, per annonce, shared by every contact control on
// the page: the seller card (twice — the phone column and the desktop rail)
// and the bar that follows a phone down the page. Asked once, shown in all,
// so a tap on the bar is one logged reveal, not one per copy.
//
// Forgotten when the last of them unmounts, i.e. on leaving the page: coming
// back to an annonce asks again, as it always did, so the reveal count a
// seller sees still counts visits that asked.
const revealed = new Map<string, RevealedContact>();
const inflight = new Map<string, Promise<Response>>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) revealed.clear();
  };
};

/**
 * The reveal, for any control that offers it: what is known, whether this
 * control is asking, and the ask. Errors are toasted here, in one place.
 */
export function useContactReveal(listingId: string) {
  const t = useTranslations("listing.contact");
  const apiError = useApiError();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const contact = useSyncExternalStore(
    subscribe,
    () => revealed.get(listingId) ?? null,
    () => null,
  );

  async function reveal() {
    setBusy(true);
    try {
      // A second tap, or the other control, while the first ask is out: wait
      // for that one rather than log a second reveal.
      let pending = inflight.get(listingId);
      if (!pending) {
        pending = fetch(`/api/annonces/${listingId}/contact`, { method: "POST" });
        inflight.set(listingId, pending);
      }
      const res = (await pending).clone();
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The route writes `detail` in this page's language; a bare code
        // (cross_origin_blocked, server_misconfigured…) goes through apiErrors.
        toast(apiError(j, t("unavailable")), res.status === 429 ? "warning" : "error");
        return;
      }
      if (!revealed.has(listingId)) {
        revealed.set(listingId, { phone: j.phone, whatsapp: j.whatsapp ?? null });
        recordSocialContact(listingId);
        for (const fn of listeners) fn();
      }
    } catch {
      toast(t("networkError"), "error");
    } finally {
      inflight.delete(listingId);
      setBusy(false);
    }
  }

  return { contact, busy, reveal };
}

/** The links a revealed number opens: tel: and wa.me. */
export function contactLinks(contact: RevealedContact): { tel: string; whatsapp: string } {
  const digits = (contact.whatsapp ?? contact.phone).replace(/\D/g, "");
  // Numbers are stored both ways — "20 123 456" and "+216 20 123 456".
  // wa.me needs the country code, so a local 8-digit number gets one, and
  // tel: gets the digits without the spaces.
  const wa = digits.length === 8 ? `216${digits}` : digits;
  return { tel: `tel:${contact.phone.replace(/[^\d+]/g, "")}`, whatsapp: `https://wa.me/${wa}` };
}

/**
 * "Afficher le numéro".
 *
 * The number is not in this page's HTML — it cannot be, because `contact_phone`
 * is granted to service_role alone (0146). It arrives only when a person asks
 * for it, and that ask is logged and rate-limited server-side. A scraper that
 * fetches a thousand listing pages gets a thousand pages with no phone numbers
 * in them; to collect numbers it has to make a thousand deliberate requests
 * from one address, which is exactly the pattern the log catches.
 *
 * It matters more here than on a car catalogue: an agency's list of everyone
 * selling property in a governorate is a saleable asset, and the reveal log is
 * what makes harvesting it visible.
 */
export function ContactReveal({
  listingId,
  showPhone = true,
}: {
  listingId: string;
  /** false when the seller chose not to publish a number at all. */
  showPhone?: boolean;
}) {
  const t = useTranslations("listing.contact");
  const { contact, busy, reveal } = useContactReveal(listingId);

  // A visit that came from a Mazed Immo post (UTM tags) is counted for that
  // post — the Social Publisher's report (src/lib/social/visit.ts).
  useEffect(() => {
    recordSocialVisit(listingId, window.location.search);
  }, [listingId]);

  if (contact) {
    const links = contactLinks(contact);
    return (
      <div className="space-y-2">
        <a
          href={links.tel}
          className="mazed-btn-luxe tap-target flex w-full items-center justify-center gap-2 px-5 py-3.5 text-[15px]"
        >
          <Phone className="size-4" strokeWidth={2.5} />
          <Ltr className="mazed-tabular">{contact.phone}</Ltr>
        </a>
        <a
          href={links.whatsapp}
          target="_blank"
          rel="noreferrer"
          className="tap-target flex w-full items-center justify-center gap-2 rounded-full border border-border bg-surface px-5 py-3 text-[13.5px] font-bold text-foreground transition hover:border-gold-soft"
        >
          <MessageCircle className="size-4" strokeWidth={2.2} />
          WhatsApp
        </a>
        <p className="text-center text-[11px] text-muted">{t("disclaimer")}</p>
      </div>
    );
  }

  // Nothing to reveal: saying so beats a button that answers « Ce vendeur ne
  // partage pas son numéro » only after it is pressed.
  if (!showPhone) {
    return (
      <p className="rounded-xl bg-surface-2 px-4 py-3 text-center text-[12.5px] text-muted ring-1 ring-border">
        {t("hidden")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void reveal()}
        disabled={busy}
        className="mazed-btn-luxe tap-target flex w-full items-center justify-center gap-2 px-5 py-3.5 text-[15px] disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Phone className="size-4" strokeWidth={2.5} />}
        {t("reveal")}
      </button>
    </div>
  );
}
