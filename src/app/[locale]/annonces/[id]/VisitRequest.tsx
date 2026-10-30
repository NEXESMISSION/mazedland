"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, Check, Loader2, Plus, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { useApiError } from "@/lib/useApiError";
import { useSetting } from "@/components/settings/SettingsProvider";
import { tunisDay, VISIT_NAME_MAX, VISIT_PARTS, type VisitSlot, type VisitStatus } from "@/lib/visits";
import { addDays, dayLabel, nextDays } from "@/lib/dayChips";
import { BUYER_PHRASES, freePart, partTaken, suggestSlot, VISIT_MESSAGE_MAX } from "@/lib/visitChoices";
import { hasPhrase, togglePhrase } from "@/lib/phrases";
import { chipClass } from "@/lib/chips";

/**
 * « Demander une visite » (0174): a few half-days (how many and how far ahead
 * is set in the console), the buyer's name and number, a word for the seller.
 * Signed out, it leads to sign-in and back. With a request already open, it
 * says where that one stands instead. Switched off, nothing: requests already
 * made stay in « Mes visites ».
 *
 * Nothing has to be typed: the days of the coming week and the three
 * half-days are chips (« Autre date » keeps the picker), another moment is
 * one tap, the name and number come from the profile, and the message opens
 * on a polite default with phrases to add.
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
  const tChips = useTranslations("visits.chips");
  const locale = useLocale();
  const { toast } = useToast();
  const apiError = useApiError();
  const ids = useId();
  const [form, setForm] = useState(false);
  // Days as Tunisia counts them, like the API that checks them.
  const [today] = useState(tunisDay);
  const [slots, setSlots] = useState<VisitSlot[]>(() => [{ day: addDays(tunisDay(), 1), part: "morning" }]);
  // The slot the day and time chips are editing.
  const [active, setActive] = useState(0);
  const [otherDate, setOtherDate] = useState(false);
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [message, setMessage] = useState(() => t("defaultMessage"));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | { status: VisitStatus; when: string | null }>(open);
  const on = useSetting("feature_visits");
  const maxSlots = useSetting("visits_max_slots");
  const horizon = useSetting("visits_horizon_days");

  if (!on) return null;

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

  const slot = slots[active] ?? slots[0];
  const days = nextDays(today, horizon);
  const words = { today: tChips("today"), tomorrow: tChips("tomorrow") };
  const say = (s: VisitSlot) => `${dayLabel(s.day, today, locale, words)} · ${tChips(s.part)}`;
  // A day past the week's chips is shown in the picker it came from.
  const showOther = otherDate || !days.includes(slot.day);
  const canAdd = slots.length < maxSlots && suggestSlot(slots, today, horizon) !== null;

  const editSlot = (patch: Partial<VisitSlot>) =>
    setSlots((s) => s.map((x, j) => (j === active ? { ...x, ...patch } : x)));

  function pickDay(day: string) {
    // Keep the time of day, unless another slot already holds it on that day.
    const part = freePart(slots, active, day, slot.part);
    if (!part) return;
    editSlot({ day, part });
    setOtherDate(false);
  }

  function addSlot() {
    const next = suggestSlot(slots, today, horizon);
    if (!next || slots.length >= maxSlots) return;
    setSlots([...slots, next]);
    setActive(slots.length);
    setOtherDate(false);
  }

  function removeSlot(i: number) {
    setSlots((s) => s.filter((_, j) => j !== i));
    setActive((a) => (a > i ? a - 1 : a === i ? Math.min(i, slots.length - 2) : a));
    setOtherDate(false);
  }

  const label = "text-[11.5px] font-bold text-foreground";
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
        <button
          type="button"
          onClick={() => setForm(false)}
          aria-label={t("close")}
          className="tap-target -me-2 inline-flex items-center justify-center text-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className="text-[11.5px] leading-snug text-muted">{t("slotsHint", { max: maxSlots })}</p>

      {/* The moments proposed so far; the chips below edit the selected one. */}
      {(slots.length > 1 || canAdd) && (
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label={t("slotsLabel")} className="flex flex-wrap gap-2">
            {slots.map((s, i) => (
              <span key={i} className="inline-flex max-w-full items-center">
                <button
                  type="button"
                  role="radio"
                  aria-checked={i === active}
                  onClick={() => { setActive(i); setOtherDate(false); }}
                  className={chipClass(i === active)}
                >
                  {say(s)}
                </button>
                {slots.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSlot(i)}
                    aria-label={`${t("removeSlot")} — ${say(s)}`}
                    className="tap-target -ms-1 inline-flex items-center justify-center rounded-full text-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </span>
            ))}
          </div>
          {canAdd && (
            <button type="button" onClick={addSlot} className={chipClass(false)}>
              <Plus className="size-3.5" /> {t("addSlot")}
            </button>
          )}
        </div>
      )}

      <div>
        <p id={`${ids}-day`} className={label}>{t("day")}</p>
        <div role="radiogroup" aria-labelledby={`${ids}-day`} className="mt-1.5 flex flex-wrap gap-2">
          {days.map((d) => {
            const picked = !showOther && slot.day === d;
            return (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={picked}
                // A day whose three half-days the other slots already hold.
                disabled={!picked && freePart(slots, active, d, slot.part) === null}
                onClick={() => pickDay(d)}
                className={chipClass(picked)}
              >
                {dayLabel(d, today, locale, words)}
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={showOther}
            onClick={() => setOtherDate(true)}
            className={chipClass(showOther)}
          >
            {tChips("otherDate")}
          </button>
        </div>
        {showOther && (
          <input
            type="date"
            required
            min={today}
            max={addDays(today, horizon)}
            value={slot.day}
            onChange={(e) => {
              const day = e.target.value;
              if (day) editSlot({ day, part: freePart(slots, active, day, slot.part) ?? slot.part });
            }}
            className={`${field} mt-2`}
            aria-labelledby={`${ids}-day`}
          />
        )}
      </div>

      <div>
        <p id={`${ids}-part`} className={label}>{t("part")}</p>
        <div role="radiogroup" aria-labelledby={`${ids}-part`} className="mt-1.5 flex flex-wrap gap-2">
          {VISIT_PARTS.map((p) => {
            const picked = slot.part === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={picked}
                disabled={!picked && partTaken(slots, active, slot.day, p)}
                onClick={() => editSlot({ part: p })}
                className={chipClass(picked)}
              >
                {tChips(p)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={VISIT_NAME_MAX} autoComplete="name" placeholder={t("name")} aria-label={t("name")} className={field} dir="auto" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} required type="tel" inputMode="tel" autoComplete="tel" placeholder={t("phone")} aria-label={t("phone")} className={field} dir="ltr" />
      </div>

      <div>
        <label htmlFor={`${ids}-message`} className={label}>{t("message")}</label>
        <textarea
          id={`${ids}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={VISIT_MESSAGE_MAX}
          rows={3}
          className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[13px] text-foreground focus:border-gold-soft focus:outline-none"
          dir="auto"
        />
        {/* What a seller wants to know first, one tap each; a second tap takes it back. */}
        <div role="group" aria-label={t("phrasesLabel")} className="mt-1 flex flex-wrap gap-2">
          {BUYER_PHRASES.map((k) => {
            const phrase = t(`phrases.${k}`);
            const added = hasPhrase(message, phrase);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={added}
                onClick={() => setMessage((m) => togglePhrase(m, phrase, VISIT_MESSAGE_MAX))}
                className={chipClass(added)}
              >
                {added ? <Check className="size-3.5 shrink-0" /> : <Plus className="size-3.5 shrink-0" />}
                {phrase}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] leading-snug text-muted">{t("shared")}</p>
      <button type="submit" disabled={busy} className="mazed-btn-luxe tap-target flex h-11 w-full items-center justify-center gap-2 text-[13.5px] disabled:opacity-60">
        {busy && <Loader2 className="size-4 animate-spin" />} {t("send")}
      </button>
    </form>
  );
}
