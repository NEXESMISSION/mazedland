import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Ltr } from "@/components/ui/Ltr";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatDate } from "@/lib/utils";
import type { VisitSide, VisitSlot } from "@/lib/visits";
import type { VisitView } from "@/lib/visits-server";
import { CalendarDays, Home, MessageSquare, Phone } from "lucide-react";
import { VisitActions } from "./VisitActions";

const TONE: Record<string, string> = {
  requested: "mazed-tone-warn",
  confirmed: "mazed-tone-ok",
  done: "mazed-tone-ok",
  declined: "mazed-tone-bad",
  cancelled: "bg-surface-2 text-muted",
};

/**
 * One visit request (0174), as its seller's side or its buyer sees it: the
 * annonce, where it stands, the half-days, and — for the seller's side — who
 * is coming and how to call them.
 */
export async function VisitCard({ visit, side, locale, highlight = false }: { visit: VisitView; side: VisitSide; locale: string; highlight?: boolean }) {
  const t = await getTranslations("visits.card");
  const tStatus = await getTranslations("visits.status");
  const tParts = await getTranslations("visits.parts");
  const say = (s: VisitSlot) => `${formatDate(`${s.day}T12:00:00Z`, locale, "weekday")} · ${tParts(s.part)}`;
  const slotLabels = visit.slots.map(say);

  return (
    <article id={`v-${visit.id}`} className={`scroll-mt-24 rounded-2xl bg-surface p-4 ring-1 ${highlight ? "ring-[var(--gold)]" : "ring-border"}`}>
      <div className="flex items-start gap-3">
        <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2 ring-1 ring-border">
          {visit.listing?.photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small thumbnail
            <img src={propertyPhotoUrl(visit.listing.photo, { transform: { width: 120, quality: 70 } })} alt="" className="size-full object-cover" />
          ) : (
            <Home className="size-5 text-muted" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          {visit.listing ? (
            <Link href={`/annonces/${visit.listing.id}` as never} className="line-clamp-1 text-[13.5px] font-bold text-foreground hover:underline" dir="auto">
              {visit.listing.title}
            </Link>
          ) : (
            <p className="text-[13.5px] font-bold text-muted">{t("listingGone")}</p>
          )}
          <p className="mt-0.5 text-[11.5px] text-muted">{t("asked", { date: formatDate(visit.created_at, locale, "dayMonth") })}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE[visit.status] ?? ""}`}>{tStatus(visit.status)}</span>
      </div>

      <div className="mt-3 space-y-1.5 text-[12.5px]">
        {visit.status === "confirmed" || visit.status === "done" ? (
          <p className="flex items-start gap-2 font-bold text-foreground">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-gold" />
            {visit.confirmed_slot ? say(visit.confirmed_slot) : slotLabels[0]}
          </p>
        ) : (
          <div className="flex items-start gap-2 text-foreground">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-muted" />
            <ul>
              {slotLabels.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {side === "seller" && (
          <p className="flex items-center gap-2 text-foreground">
            <Phone className="size-4 shrink-0 text-muted" />
            <span dir="auto">{visit.buyer_name}</span> ·{" "}
            <a href={`tel:${visit.buyer_phone}`} className="font-bold hover:underline">
              <Ltr>{visit.buyer_phone}</Ltr>
            </a>
          </p>
        )}
        {visit.message && (
          <p className="flex items-start gap-2 text-muted">
            <MessageSquare className="mt-0.5 size-4 shrink-0" />
            <span className="whitespace-pre-line" dir="auto">{visit.message}</span>
          </p>
        )}
        {visit.seller_note && (
          <p className="rounded-xl bg-surface-2 px-3 py-2 text-foreground ring-1 ring-border" dir="auto">
            <span className="font-bold">{t(side === "seller" ? "yourNote" : "sellerNote")} </span>
            {visit.seller_note}
          </p>
        )}
      </div>

      <div className="mt-3">
        <VisitActions visitId={visit.id} side={side} status={visit.status} slots={visit.slots} slotLabels={slotLabels} />
      </div>
    </article>
  );
}
