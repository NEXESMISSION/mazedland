"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Facebook, MessageCircle, Share2 } from "lucide-react";
import { useSetting } from "@/components/settings/SettingsProvider";
import { useToast } from "@/components/ui/Toast";
import { shareLinks } from "@/lib/share";
import { cn } from "@/lib/utils";

/**
 * « Partager » on an annonce. An annonce travels as a link — into WhatsApp, a
 * Messenger group, the family — and its page already gives the link a photo
 * and a price (Open Graph), so the button only has to hand the link over:
 *
 *  - on a phone, the system's own share sheet (every app the person has);
 *  - elsewhere, WhatsApp, Facebook and « Copier le lien ».
 *
 * The link is the page's own address without its query string, so a share
 * never carries a search or a tracking parameter along — or `href`, the
 * annonce's path, when the button sits in a list (« Mes annonces », the
 * agence's dashboard) and not on the annonce itself. `text` is what travels
 * with the link (src/lib/share.ts shareText); the title alone otherwise.
 * Switched off with feature_share.
 */
export function ShareButton({
  title,
  text,
  href,
  variant = "pill",
  className,
}: {
  title: string;
  /** The words sent with the link: « Villa S+3 · 450 000 DT · Sfax ». */
  text?: string;
  /** The annonce's path (`/fr/annonces/<id>`) when not on its page. */
  href?: string;
  /** `pill`: a bordered button; `text`: a bare link, for a row of actions. */
  variant?: "pill" | "text";
  className?: string;
}) {
  const t = useTranslations("share");
  const enabled = useSetting("feature_share");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close the little menu on a tap outside or Escape.
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", off);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", off);
    };
  }, [open]);

  if (!enabled) return null;

  const link = () => `${window.location.origin}${href ?? window.location.pathname}`;
  const words = text ?? title;

  async function share() {
    const url = link();
    const touch = window.matchMedia?.("(pointer: coarse)").matches;
    if (touch && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text: words, url });
        return;
      } catch (e) {
        // The person closed the sheet: nothing to say. Anything else: the menu.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    setOpen((v) => !v);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link());
      setCopied(true);
      toast(t("copied"), "success");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t("copyFailed"), "error");
    }
  }

  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-[13px] font-semibold text-foreground transition hover:bg-surface-2";

  return (
    <div ref={box} className={cn("relative", className)}>
      <button
        type="button"
        onClick={share}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          variant === "text"
            ? "tap-target inline-flex items-center gap-1 text-[12.5px] font-bold text-foreground hover:underline"
            : "tap-target inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-3 text-[12.5px] font-bold text-foreground transition hover:bg-surface-2"
        }
      >
        <Share2 className={variant === "text" ? "size-3.5" : "size-4"} />
        {t("label")}
      </button>
      {open && (
        <div role="menu" className="absolute start-1/2 top-full z-40 mt-1.5 w-56 -translate-x-1/2 rounded-xl bg-surface p-1.5 shadow-lg ring-1 ring-border rtl:translate-x-1/2">
          <a
            role="menuitem"
            href={shareLinks(words, link()).whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={item}
          >
            <MessageCircle className="size-4 text-[#25D366]" /> WhatsApp
          </a>
          <a
            role="menuitem"
            href={shareLinks(words, link()).facebook}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={item}
          >
            <Facebook className="size-4 text-[#1877F2]" /> Facebook
          </a>
          <button type="button" role="menuitem" onClick={copy} className={item}>
            {copied ? <Check className="size-4 text-[var(--tone-ok)]" /> : <Copy className="size-4 text-muted" />}
            {t("copy")}
          </button>
        </div>
      )}
    </div>
  );
}
