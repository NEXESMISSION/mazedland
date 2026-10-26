"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { formatTND } from "@/lib/utils";
import { Check, Loader2, ShieldCheck } from "lucide-react";
import { OFFERED_CHANNELS, SOCIAL_LANGUAGES, type SocialChannel, type SocialLanguage } from "@/lib/social/channels";
import { PostPreview } from "@/components/social/PostPreview";

/**
 * The ask itself. Nothing is ticked to begin with — the seller picks every
 * channel — and the button stays off until they have picked one and agreed
 * to the sentence that says what will be posted and that their number never
 * is. The previews are the texts the server generated, in each language.
 */
export function PromoteForm({
  listingId,
  previews,
  photos,
  hasPhotos,
  priceTnd,
}: {
  listingId: string;
  previews: Record<SocialLanguage, Record<SocialChannel, string>>;
  photos: string[];
  hasPhotos: boolean;
  priceTnd: number;
}) {
  const t = useTranslations("promote");
  const router = useRouter();
  const { toast } = useToast();
  const apiError = useApiError();
  const [channels, setChannels] = useState<SocialChannel[]>([]);
  const [language, setLanguage] = useState<SocialLanguage>("both");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggle = (c: SocialChannel) =>
    setChannels((now) => (now.includes(c) ? now.filter((x) => x !== c) : [...now, c]));

  async function submit() {
    if (channels.length === 0 || !consent) return;
    setBusy(true);
    try {
      const res = await fetch("/api/social/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId, channels, language, consent }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), "error");
        return;
      }
      toast(t(j.status === "scheduled" ? "sentScheduled" : "sent"), "success");
      router.refresh();
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  const ordered = OFFERED_CHANNELS.filter((c) => channels.includes(c));

  return (
    <div className="mt-6 space-y-5">
      {/* Where */}
      <section>
        <h2 className="text-[14px] font-extrabold text-foreground">{t("whereTitle")}</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">{t("whereHint")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {OFFERED_CHANNELS.map((c) => {
            const disabled = c === "instagram" && !hasPhotos;
            const on = channels.includes(c);
            return (
              <button
                key={c}
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={disabled}
                onClick={() => toggle(c)}
                className={[
                  "tap-target flex items-start gap-3 rounded-2xl border p-3.5 text-start transition disabled:opacity-50",
                  on ? "border-gold bg-gold-faint" : "border-border bg-surface hover:border-gold-soft",
                ].join(" ")}
              >
                <span
                  className={[
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md ring-1",
                    on ? "bg-gold text-[var(--background)] ring-gold" : "ring-border",
                  ].join(" ")}
                >
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-foreground">{t(`channels.${c}.name`)}</span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                    {disabled ? t("instagramNeedsPhoto") : t(`channels.${c}.hint`)}
                  </span>
                </span>
              </button>
            );
          })}
          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border p-3.5 opacity-60">
            <span className="mt-0.5 size-5 shrink-0 rounded-md ring-1 ring-border" />
            <span>
              <span className="block text-[13.5px] font-bold text-foreground">{t("channels.tiktok.name")}</span>
              <span className="mt-0.5 block text-[12px] text-muted">{t("channels.tiktok.hint")}</span>
            </span>
          </div>
        </div>
      </section>

      {/* Language */}
      <section>
        <h2 className="text-[14px] font-extrabold text-foreground">{t("languageTitle")}</h2>
        <div className="mt-2 inline-flex rounded-xl bg-surface-2 p-1 ring-1 ring-border">
          {SOCIAL_LANGUAGES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLanguage(l)}
              aria-pressed={language === l}
              className={[
                "tap-target rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition",
                language === l ? "bg-surface text-foreground shadow-sm ring-1 ring-border" : "text-muted hover:text-foreground",
              ].join(" ")}
            >
              {t(`languages.${l}`)}
            </button>
          ))}
        </div>
      </section>

      {/* Preview */}
      <section>
        <h2 className="text-[14px] font-extrabold text-foreground">{t("previewTitle")}</h2>
        {ordered.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-border p-5 text-center text-[12.5px] text-muted">
            {t("previewEmpty")}
          </p>
        ) : (
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            {ordered.map((c) => (
              <PostPreview key={c} channel={c} body={previews[language][c]} photos={photos} label={t(`channels.${c}.name`)} />
            ))}
          </div>
        )}
        <p className="mt-2 text-[11.5px] text-muted">{t("previewNote")}</p>
      </section>

      {/* Price and consent */}
      <section className="rounded-2xl border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-bold text-foreground">{t("priceTitle")}</span>
          <span className="text-[14px] font-extrabold text-gold">
            {priceTnd > 0 ? t("price", { amount: formatTND(priceTnd, "fr") }) : t("freeLaunch")}
          </span>
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--gold)]"
          />
          <span className="text-[12.5px] leading-relaxed text-foreground">{t("consent")}</span>
        </label>
        <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-snug text-muted">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> {t("reviewNote")}
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={busy || channels.length === 0 || !consent}
          className="mazed-btn-luxe tap-target mt-4 flex h-12 w-full items-center justify-center gap-2 text-[14px] disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {t("confirm")}
        </button>
      </section>
    </div>
  );
}
