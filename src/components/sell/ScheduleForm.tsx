"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { AuctionType } from "@/lib/types";
import { CheckCircle2, Check, Gavel, EyeOff, TrendingDown, Scale } from "lucide-react";

// Each format carries a plain-French one-liner so the seller actually
// understands what they're choosing — that was the confusing part.
const FORMATS: {
  value: AuctionType;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  desc: string;
}[] = [
  {
    value: "english",
    Icon: Gavel,
    label: "Anglaise",
    desc: "Le prix monte à chaque offre. La plus haute l'emporte à la clôture.",
  },
  {
    value: "sealed",
    Icon: EyeOff,
    label: "Cachetée",
    desc: "Offres secrètes, révélées à la fin. La plus élevée gagne.",
  },
  {
    value: "dutch",
    Icon: TrendingDown,
    label: "Dégressive",
    desc: "Le prix baisse avec le temps. Le premier à accepter remporte le lot.",
  },
];

function defaultStart() {
  // 1 hour from now, rounded to the next 15 min, formatted for
  // <input type="datetime-local"> (no timezone, local clock).
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}
function defaultEnd() {
  // 7 days after default start.
  const d = new Date(Date.now() + 60 * 60 * 1000 + 7 * 86_400_000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(d);
}
function toLocalInput(d: Date) {
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 16);
}

export function ScheduleForm({
  propertyId,
  extendWindowSec,
  extendBySec,
  dutchEnabled = false,
  sealedEnabled = false,
  finalPaymentDays = 14,
}: {
  propertyId: string;
  /** Admin-configured anti-snipe values (seconds), baked onto the new
   *  auction so the platform setting governs it. Omitted → DB column
   *  defaults (300 / 600) apply. */
  extendWindowSec?: number;
  extendBySec?: number;
  /** Which optional formats the admin enabled (English is always on). The
   *  DB guard (migration 0130) also enforces this server-side. */
  dutchEnabled?: boolean;
  sealedEnabled?: boolean;
  /** Admin-configured days the winner has to pay the balance (default 14). */
  finalPaymentDays?: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  // Only English + admin-enabled formats. English is always first/available.
  const formats = useMemo(
    () =>
      FORMATS.filter(
        (f) =>
          f.value === "english" ||
          (f.value === "dutch" && dutchEnabled) ||
          (f.value === "sealed" && sealedEnabled),
      ),
    [dutchEnabled, sealedEnabled],
  );
  const [type, setType] = useState<AuctionType>("english");
  // Legal 1/6 overbid window — opt-in per auction (default off). Not relevant
  // for Dutch (it sells instantly, no post-hammer window).
  const [sixthOfferEnabled, setSixthOfferEnabled] = useState<boolean>(false);
  const [openingPrice, setOpeningPrice] = useState<string>("");
  const [reservePrice, setReservePrice] = useState<string>("");
  const [startsAt, setStartsAt] = useState<string>(defaultStart());
  const [endsAt, setEndsAt] = useState<string>(defaultEnd());
  // Dutch-specific
  const [dutchStart, setDutchStart] = useState<string>("");
  const [dutchFloor, setDutchFloor] = useState<string>("");
  const [dutchDecrement, setDutchDecrement] = useState<string>("5000");
  const [dutchTick, setDutchTick] = useState<string>("1800");

  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Human-readable window length, shown under the date pickers so a typo
  // (wrong month → 6-month auction) is obvious before submitting.
  const durationLabel = useMemo(() => {
    const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return null;
    const days = Math.floor(ms / 86_400_000);
    const hours = Math.round((ms % 86_400_000) / 3_600_000);
    if (days > 0) return `${days} jour${days > 1 ? "s" : ""}${hours ? ` ${hours} h` : ""}`;
    return `${hours} h`;
  }, [startsAt, endsAt]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const opening = Number(openingPrice);
    if (!opening || opening < 1000) {
      setError(t("schedule.errors.openingTooLow"));
      return;
    }
    if (opening > 1_000_000_000) {
      setError(t("schedule.errors.openingTooHigh"));
      return;
    }
    // Reserve price guard — if set, it should be ≥ opening (otherwise
    // the reserve has no effect and confuses the seller).
    if (reservePrice) {
      const rp = Number(reservePrice);
      if (!Number.isFinite(rp) || rp < opening) {
        setError(t("schedule.errors.reserveBelowOpening"));
        return;
      }
    }
    const startsIso = new Date(startsAt).toISOString();
    const endsIso = new Date(endsAt).toISOString();
    if (new Date(endsIso) <= new Date(startsIso)) {
      setError(t("schedule.errors.endBeforeStart"));
      return;
    }
    // Duration sanity: at least 30 min, at most 60 days. Without these
    // a typo (e.g. picking the wrong month) can ship a 6-month auction
    // that the seller didn't intend, or a 1-minute "live" window that
    // ends before anyone can bid.
    const durationMs = new Date(endsIso).getTime() - new Date(startsIso).getTime();
    if (durationMs < 30 * 60_000) {
      setError(t("schedule.errors.tooShort"));
      return;
    }
    if (durationMs > 60 * 86_400_000) {
      setError(t("schedule.errors.tooLong"));
      return;
    }
    // Past end guard — datetime-local lets the user type anything,
    // including a year ago. Without this check, the auction lands in
    // an immediately-ended state with no recovery.
    if (new Date(endsIso).getTime() <= Date.now()) {
      setError(t("schedule.errors.endInPast"));
      return;
    }

    // Dutch sanity: start_price > floor_price, decrement positive,
    // tick interval reasonable. Without these the engine produces
    // either a stuck price (decrement=0) or jumps below floor in one
    // tick (start ≈ floor with a big decrement).
    if (type === "dutch") {
      const dStart = Number(dutchStart) || opening * 1.2;
      const dFloor = Number(dutchFloor) || opening;
      const dDec = Number(dutchDecrement) || 5000;
      const dTick = Number(dutchTick) || 1800;
      if (dStart <= dFloor) {
        setError(t("schedule.errors.dutchStartBelowFloor"));
        return;
      }
      if (dDec <= 0 || dDec >= dStart - dFloor) {
        setError(t("schedule.errors.dutchDecrementInvalid"));
        return;
      }
      if (dTick < 30 || dTick > 86_400) {
        setError(t("schedule.errors.dutchTickInvalid"));
        return;
      }
    }

    // If start is in the past or within the next minute, treat the auction
    // as already "live" so bids can land immediately. Otherwise it's
    // "scheduled" and the bid route will reject early bids.
    const liveNow = new Date(startsIso).getTime() <= Date.now() + 60_000;

    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const payload: Record<string, unknown> = {
        property_id: propertyId,
        type,
        opening_price: opening,
        reserve_price: reservePrice ? Number(reservePrice) : null,
        starts_at: startsIso,
        ends_at: endsIso,
        status: liveNow ? "live" : "scheduled",
        current_price: opening,
        // Legal 1/6 overbid window — only meaningful for english/sealed.
        sixth_offer_enabled: type === "dutch" ? false : sixthOfferEnabled,
      };
      if (typeof extendWindowSec === "number") payload.extend_window_seconds = extendWindowSec;
      if (typeof extendBySec === "number") payload.extend_by_seconds = extendBySec;
      if (type === "dutch") {
        const start = Number(dutchStart) || opening * 1.2;
        const floor = Number(dutchFloor) || opening;
        payload.dutch_start_price = start;
        payload.dutch_floor_price = floor;
        payload.dutch_decrement = Number(dutchDecrement) || 5000;
        payload.dutch_tick_seconds = Number(dutchTick) || 1800;
        payload.current_price = start;
      }

      const { data, error } = await supabase.from("auctions").insert(payload).select("id").single();
      if (error || !data) {
        setError(error?.message ?? t("schedule.errors.couldNotSchedule"));
        return;
      }
      setCreatedId(data.id as string);
    });
  }

  if (createdId) {
    return (
      <div className="batta-frame-gold mt-6 p-6 text-center">
        <div className="relative">
          <span className="batta-tone-ok mx-auto inline-flex size-12 items-center justify-center rounded-full">
            <CheckCircle2 className="size-6" strokeWidth={2.2} />
          </span>
          <h2 className="mt-3 text-[18px] font-extrabold text-foreground">{t("schedule.successTitle")}</h2>
          <p className="mt-1 text-[12px] text-muted">{t("schedule.successBody")}</p>
          <button
            type="button"
            onClick={() => router.replace(`/auctions/${createdId}` as `/auctions/${string}`)}
            className="batta-btn-luxe tap-target mt-5 w-full px-5 py-3 text-[13.5px]"
          >
            {t("schedule.viewAuction")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* ── 1. Format ── (only English unless the admin enabled extras) */}
      <section>
        <SectionTitle n={1} title="Format de l'enchère" />
        {formats.length === 1 ? (
          // English-only marketplace — show the single format as a calm
          // info card instead of a pointless one-option picker.
          <div className="mt-3 flex items-start gap-3 rounded-2xl border border-[var(--gold)] bg-[var(--gold-faint)] p-3.5 ring-1 ring-[var(--gold)]">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--gold)] text-white">
              <Gavel className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-[14px] font-bold text-foreground">{formats[0].label}</span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">{formats[0].desc}</span>
            </span>
            <Check className="size-4 shrink-0 text-[var(--gold)]" strokeWidth={3} />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {formats.map(({ value, Icon, label, desc }) => {
              const active = type === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setType(value)}
                  className={`tap-target flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start transition ${
                    active
                      ? "border-[var(--gold)] bg-[var(--gold-faint)] ring-1 ring-[var(--gold)]"
                      : "border-[var(--border)] bg-surface hover:border-[var(--gold)]/40"
                  }`}
                >
                  <span
                    className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${
                      active
                        ? "bg-[var(--gold)] text-white"
                        : "bg-surface-2 text-[var(--gold)] ring-1 ring-border"
                    }`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[14px] font-bold text-foreground">{label}</span>
                      {active && <Check className="size-4 text-[var(--gold)]" strokeWidth={3} />}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                      {desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 2. Prix ── */}
      <section>
        <SectionTitle n={2} title="Prix" />
        <div className="mt-3 space-y-3">
          <Field
            label={t("schedule.openingPrice")}
            type="number"
            value={openingPrice}
            onChange={setOpeningPrice}
            required
            suffix="TND"
            hint="Le point de départ des enchères."
          />

          {type !== "dutch" && (
            <Field
              label={t("schedule.reservePrice")}
              type="number"
              value={reservePrice}
              onChange={setReservePrice}
              suffix="TND"
              hint={t("schedule.reserveHint")}
            />
          )}

          {type === "dutch" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prix de départ" type="number" value={dutchStart} onChange={setDutchStart} suffix="TND" hint="Le plus haut." />
              <Field label="Prix plancher" type="number" value={dutchFloor} onChange={setDutchFloor} suffix="TND" hint="Le plus bas accepté." />
              <Field label="Baisse / palier" type="number" value={dutchDecrement} onChange={setDutchDecrement} suffix="TND" />
              <Field label="Intervalle" type="number" value={dutchTick} onChange={setDutchTick} suffix="sec" />
            </div>
          )}
        </div>
      </section>

      {/* ── 3. Période ── */}
      <section>
        <SectionTitle n={3} title="Période" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label={t("schedule.startsAt")} type="datetime-local" value={startsAt} onChange={setStartsAt} required />
          <Field label={t("schedule.endsAt")} type="datetime-local" value={endsAt} onChange={setEndsAt} required />
        </div>
        {durationLabel && (
          <p className="mt-2 text-[11.5px] text-muted">
            Durée : <span className="font-bold text-foreground">{durationLabel}</span>
          </p>
        )}
      </section>

      {/* ── 4. Surenchère du 1/6 (opt-in) ── not applicable to Dutch ── */}
      {type !== "dutch" && (
        <section>
          <SectionTitle n={4} title="Surenchère du 1/6 (optionnel)" />
          <button
            type="button"
            onClick={() => setSixthOfferEnabled((s) => !s)}
            className={`tap-target mt-3 flex w-full items-start gap-3 rounded-2xl border p-3.5 text-start transition ${
              sixthOfferEnabled
                ? "border-[var(--gold)] bg-[var(--gold-faint)] ring-1 ring-[var(--gold)]"
                : "border-[var(--border)] bg-surface hover:border-[var(--gold)]/40"
            }`}
          >
            <span
              className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${
                sixthOfferEnabled
                  ? "bg-[var(--gold)] text-white"
                  : "bg-surface-2 text-[var(--gold)] ring-1 ring-border"
              }`}
            >
              <Scale className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-[14px] font-bold text-foreground">
                  Autoriser une dernière surenchère après la vente
                </span>
                {sixthOfferEnabled && <Check className="size-4 text-[var(--gold)]" strokeWidth={3} />}
              </span>
              <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                {sixthOfferEnabled
                  ? "Activé : après l'adjudication, on ouvre 8 jours pendant lesquels un participant peut surenchérir d'au moins 1/6 (≈ +16,7 %). Cela peut faire monter votre prix de vente, mais retarde la finalisation."
                  : `Désactivé : dès la fin de l'enchère, le gagnant est définitif et paie sous ${finalPaymentDays} jours. Plus simple et plus rapide (recommandé).`}
              </span>
            </span>
          </button>
        </section>
      )}

      {error && <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target sticky bottom-[calc(var(--batta-bottombar-h)+var(--batta-safe-bottom)+12px)] z-20 w-full px-5 py-3.5 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? t("schedule.submitting") : t("schedule.submit")}
      </button>
    </form>
  );
}

function SectionTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[10px] font-extrabold text-white">
        {n}
      </span>
      <span className="text-[13px] font-bold text-foreground">{title}</span>
    </div>
  );
}

function Field({
  label, type = "text", value, onChange, required, hint, suffix,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="batta-eyebrow text-[10px]">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      <div className="relative mt-1.5">
        <input
          type={type}
          value={value}
          required={required}
          inputMode={type === "number" ? "numeric" : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full rounded-xl border border-gold/25 bg-surface-2 px-3 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40 ${
            suffix ? "pe-12" : ""
          }`}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
            {suffix}
          </span>
        )}
      </div>
      {hint && <span className="mt-0.5 block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}
