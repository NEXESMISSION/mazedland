"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { AuctionType } from "@/lib/types";
import { CheckCircle2, Gavel, EyeOff, TrendingDown } from "lucide-react";

const FORMATS: { value: AuctionType; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "english", Icon: Gavel },
  { value: "sealed", Icon: EyeOff },
  { value: "dutch", Icon: TrendingDown },
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

export function ScheduleForm({ propertyId }: { propertyId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [type, setType] = useState<AuctionType>("english");
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
      };
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
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      {/* Format picker — segmented, full width */}
      <div>
        <span className="text-xs font-semibold text-batta-ink/80">{t("schedule.format")}</span>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {FORMATS.map(({ value, Icon }) => {
            const active = type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setType(value)}
                className={`tap-target flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-[11px] font-bold uppercase tracking-[0.12em] transition ${
                  active
                    ? "border-gold-deep bg-gold-faint text-gold-bright shadow-[0_0_12px_var(--gold-glow)]"
                    : "border-border bg-surface text-muted hover:border-gold/40"
                }`}
              >
                <Icon className="size-4" />
                {t(`schedule.${value}`)}
              </button>
            );
          })}
        </div>
      </div>

      <Field label={t("schedule.openingPrice")} type="number" value={openingPrice} onChange={setOpeningPrice} required />

      {type !== "dutch" && (
        <>
          <Field label={t("schedule.reservePrice")} type="number" value={reservePrice} onChange={setReservePrice} hint={t("schedule.reserveHint")} />
        </>
      )}

      {type === "dutch" && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("schedule.dutchStart")} type="number" value={dutchStart} onChange={setDutchStart} />
          <Field label={t("schedule.dutchFloor")} type="number" value={dutchFloor} onChange={setDutchFloor} />
          <Field label={t("schedule.dutchDecrement")} type="number" value={dutchDecrement} onChange={setDutchDecrement} />
          <Field label={t("schedule.dutchTick")} type="number" value={dutchTick} onChange={setDutchTick} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("schedule.startsAt")} type="datetime-local" value={startsAt} onChange={setStartsAt} required />
        <Field label={t("schedule.endsAt")} type="datetime-local" value={endsAt} onChange={setEndsAt} required />
      </div>

      {error && <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target sticky bottom-[calc(var(--batta-bottombar-h)+var(--batta-safe-bottom)+12px)] z-20 mt-4 w-full px-5 py-3.5 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? t("schedule.submitting") : t("schedule.submit")}
      </button>
    </form>
  );
}

function Field({
  label, type = "text", value, onChange, required, hint,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="batta-eyebrow text-[10px]">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-gold/25 bg-surface-2 px-3 py-2.5 text-sm text-foreground focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/40"
      />
      {hint && <span className="mt-0.5 block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}
