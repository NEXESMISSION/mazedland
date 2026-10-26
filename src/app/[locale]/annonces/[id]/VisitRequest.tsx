"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, Loader2, Plus, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { MAX_SLOTS, SLOT_HORIZON_DAYS, VISIT_PARTS, type VisitPart, type VisitStatus } from "@/lib/visits";

type Slot = { day: string; part: VisitPart };

function dayPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
}

/**
 * « Demander une visite » (0174): up to three half-days, the buyer's name and
 * number, a word for the seller. Signed out, it leads to sign-in and back.
 * With a request already open, it says where that one stands instead.
 */
export function VisitRequest({
  listingId,
  loggedIn,
  defaultName,
  defaultPhone,
  open,
}: {
  listingId: string;
  loggedIn: boolean;
  defaultName: string;
  defaultPhone: string;
  /** The buyer's request on this annonce that is still waiting or set. */
  open: { status: VisitStatus; when: string | null } | null;
}) {
  const t = useTranslations("visits.request");
  const tParts = useTranslations("visits.parts");
  const locale = useLocale();
  const { toast } = useToast();
  const apiError = useApiError();
  const [form, setForm] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([{ day: dayPlus(1), part: "morning" }]);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | { status: VisitStatus; when: string | null }>(open);

  if (sent) {
    return (
      <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[12.5px] leading-snug text-foreground ring-1 ring-border">
        <p className="flex items-center gap-1.5 font-bold">
          <CalendarCheck className="size-4 text-gold" /> {t(sent.status === "confirmed" ? "confirmedTitle" : "sentTitle")}
        </p>
        <p className="mt-0.5 text-muted">{sent.status === "confirmed" && sent.when ? sent.when : t("sentBody")}</p>
        <Link href="/account/visites?tab=sent" className="mt-1 inline-block font-bold text-gold hover:underline">
          {t("follow")}
        </Link>
      </div>
    );
  }

  if (!loggedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(`/${locale}/annonces/${listingId}`)}` as never}
        className="tap-target mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-[13.5px] font-bold text-foreground transition hover:bg-surface-2"
      >
        <CalendarCheck className="size-4" /> {t("cta")}
      </Link>
    );
  }

  if (!form) {
    return (
      <button
        type="button"
        onClick={() => setForm(true)}
        className="tap-target mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-[13.5px] font-bold text-foreground transition hover:bg-surface-2"
      >
        <CalendarCheck className="size-4" /> {t("cta")}
      </button>
    );
  }

  const setSlot = (i: number, patch: Partial<Slot>) => setSlots((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const field = "h-10 w-full rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground focus:border-gold-soft focus:outline-none";

  async function send() {
    setBusy(true);
    try {
      const res = await fetch("/api/visites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId, slots, name, phone, message }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(apiError(j, t("failed")), res.status === 409 || res.status === 429 ? "warning" : "error");
        return;
      }
      toast(t("sentToast"), "success");
      setSent({ status: "requested", when: null });
    } catch {
      toast(t("failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id="visite"
      className="mt-3 space-y-3 rounded-xl bg-surface-2 p-3 ring-1 ring-border"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-extrabold text-foreground">{t("title")}</p>
        <button type="button" onClick={() => setForm(false)} aria-label={t("close")} className="text-muted hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{t("slotsHint", { max: MAX_SLOTS })}</p>
      {slots.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="date"
            required
            min={dayPlus(0)}
            max={dayPlus(SLOT_HORIZON_DAYS)}
            value={s.day}
            onChange={(e) => setSlot(i, { day: e.target.value })}
            className={field}
            aria-label={t("day")}
          />
          <select value={s.part} onChange={(e) => setSlot(i, { part: e.target.value as VisitPart })} className={field} aria-label={t("part")}>
            {VISIT_PARTS.map((p) => (
              <option key={p} value={p}>{tParts(p)}</option>
            ))}
          </select>
          {slots.length > 1 && (
            <button type="button" onClick={() => setSlots((x) => x.filter((_, j) => j !== i))} aria-label={t("removeSlot")} className="shrink-0 text-muted hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
      ))}
      {slots.length < MAX_SLOTS && (
        <button
          type="button"
          onClick={() => setSlots((x) => [...x, { day: dayPlus(x.length + 1), part: "afternoon" }])}
          className="inline-flex items-center gap-1 text-[12px] font-bold text-gold hover:underline"
        >
          <Plus className="size-3.5" /> {t("addSlot")}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} placeholder={t("name")} aria-label={t("name")} className={field} dir="auto" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" placeholder={t("phone")} aria-label={t("phone")} className={field} dir="ltr" />
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={600}
        rows={2}
        placeholder={t("message")}
        aria-label={t("message")}
        className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground focus:border-gold-soft focus:outline-none"
        dir="auto"
      />
      <p className="text-[11px] leading-snug text-muted">{t("shared")}</p>
      <button type="submit" disabled={busy} className="mazed-btn-luxe tap-target flex h-11 w-full items-center justify-center gap-2 text-[13.5px] disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />} {t("send")}
      </button>
    </form>
  );
}
