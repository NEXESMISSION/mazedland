import { redirect, Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { Building2, ChevronRight, ChevronLeft, Gavel, History, Heart, ArrowUpRight } from "lucide-react";
import { ActivityTabs, type ActivityItem } from "./ActivityTabs";
import { FocusRowHighlight } from "@/components/ui/FocusRowHighlight";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RawAuction = {
  id: string;
  status: string;
  opening_price: number;
  current_price: number | null;
  winner_amount: number | null;
  winner_user_id: string | null;
  ends_at: string;
  starts_at: string | null;
  property: {
    title: string;
    governorate: string;
    status: string;
    photos: { storage_path: string; sort_order: number }[];
  } | null;
};

const LIVE = ["live", "extending", "scheduled"];
const WON = ["ended_sold", "awarded", "sixth_offer_window"];
// Pre-publication property states never belong in a buyer's favourites.
const HIDDEN_PROPERTY = ["pending_review", "rejected", "draft"];

const TAB_KEYS = ["enCours", "enAttente", "gagnees", "participees", "favoris"] as const;
type TabKey = (typeof TAB_KEYS)[number];

export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab } = await searchParams;
  const initialTab = (TAB_KEYS as readonly string[]).includes(tab ?? "")
    ? (tab as TabKey)
    : undefined;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  // What the user is involved in: auctions they bid on, hold a deposit on,
  // or have a caution payment still awaiting validation.
  const [bidsRes, depRes, watchRes, pendRes] = await Promise.all([
    supabase.from("bids").select("auction_id, amount").eq("bidder_id", user!.id),
    supabase
      .from("auction_deposits")
      .select("auction_id, amount, released_at, refunded_at, forfeited_at")
      .eq("user_id", user!.id),
    supabase
      .from("watchlist")
      .select(`auction:auctions!inner (
        id, status, opening_price, current_price, winner_amount, winner_user_id, ends_at, starts_at,
        property:properties!inner ( title, governorate, status, photos:property_photos (storage_path, sort_order) )
      )`)
      .eq("user_id", user!.id),
    // Caution payments the user started but that aren't captured yet —
    // these are the "waiting to be accepted" auctions.
    supabase
      .from("payments")
      .select("id, auction_id, status")
      .eq("user_id", user!.id)
      .eq("kind", "deposit_lock")
      .in("status", ["pending", "pending_review"])
      .not("auction_id", "is", null),
  ]);

  // Highest bid per auction.
  const myBid = new Map<string, number>();
  for (const b of bidsRes.data ?? []) {
    const id = b.auction_id as string;
    const amt = Number(b.amount);
    if (!myBid.has(id) || amt > (myBid.get(id) ?? 0)) myBid.set(id, amt);
  }
  const participatedIds = Array.from(
    new Set<string>([
      ...(bidsRes.data ?? []).map((b) => b.auction_id as string),
      ...(depRes.data ?? []).map((d) => d.auction_id as string),
    ]),
  );

  // Per-auction caution lifecycle, so a participant can see where their
  // money is (locked → flagged for refund → refunded). Free entries are
  // zero-amount rows; surface them as "gratuite", not a money chip.
  type DepStatus = "free" | "locked" | "to_refund" | "refunded" | "forfeited";
  const depByAuction = new Map<string, { amount: number; status: DepStatus }>();
  for (const d of depRes.data ?? []) {
    const amount = Number(d.amount);
    const status: DepStatus =
      amount === 0 ? "free"
      : d.refunded_at ? "refunded"
      : d.forfeited_at ? "forfeited"
      : d.released_at ? "to_refund"
      : "locked";
    depByAuction.set(d.auction_id as string, { amount, status });
  }

  // Auctions whose caution is still in flight (no captured deposit yet).
  // "receipt" = the buyer still has to upload the receipt; "review" = it's
  // uploaded and waiting on an admin.
  const pendingByAuction = new Map<
    string,
    { kind: "receipt" | "review"; paymentId: string }
  >();
  for (const p of pendRes.data ?? []) {
    const aid = p.auction_id as string | null;
    if (!aid || depByAuction.has(aid)) continue;
    const kind = p.status === "pending_review" ? "review" : "receipt";
    const existing = pendingByAuction.get(aid);
    // Prefer the further-along "review" state if duplicate rows exist.
    if (!existing || kind === "review") {
      pendingByAuction.set(aid, { kind, paymentId: p.id as string });
    }
  }

  const allIds = Array.from(
    new Set<string>([...participatedIds, ...pendingByAuction.keys()]),
  );

  let participated: RawAuction[] = [];
  if (allIds.length > 0) {
    const { data } = await supabase
      .from("auctions")
      .select(`
        id, status, opening_price, current_price, winner_amount, winner_user_id, ends_at, starts_at,
        property:properties ( title, governorate, status, photos:property_photos (storage_path, sort_order) )
      `)
      .in("id", allIds);
    participated = (data ?? []) as unknown as RawAuction[];
  }

  const map = (a: RawAuction, won: boolean): ActivityItem => {
    const cover = (a.property?.photos ?? []).slice().sort((x, y) => x.sort_order - y.sort_order)[0];
    return {
      auctionId: a.id,
      title: a.property?.title ?? "—",
      governorate: a.property?.governorate ?? "",
      coverUrl: cover ? propertyPhotoUrl(cover.storage_path) : null,
      status: a.status,
      price: won
        ? Number(a.winner_amount ?? a.current_price ?? a.opening_price)
        : Number(a.current_price ?? a.opening_price),
      myBid: myBid.get(a.id) ?? null,
      startsAt: a.starts_at,
      endsAt: a.ends_at,
      deposit: depByAuction.get(a.id) ?? null,
    };
  };

  const enCours: ActivityItem[] = [];
  const enAttente: ActivityItem[] = [];
  const gagnees: ActivityItem[] = [];
  const participees: ActivityItem[] = [];
  for (const a of participated) {
    const pending = pendingByAuction.get(a.id);
    if (pending) {
      const item = map(a, false);
      item.pending = pending;
      enAttente.push(item);
      continue;
    }
    const won = a.winner_user_id === user!.id && WON.includes(a.status);
    if (won) gagnees.push(map(a, true));
    else if (LIVE.includes(a.status)) enCours.push(map(a, false));
    else participees.push(map(a, false));
  }

  const favoris: ActivityItem[] = (
    (watchRes.data ?? []) as unknown as Array<{ auction: RawAuction }>
  )
    .map((w) => w.auction)
    .filter((a) => a && !HIDDEN_PROPERTY.includes(a.property?.status ?? ""))
    .map((a) => map(a, a.winner_user_id === user!.id && WON.includes(a.status)));

  const isRTL = locale === "ar";
  const ChevronEnd = isRTL ? ChevronLeft : ChevronRight;

  // Tab counts for the desktop summary strip (mirror ActivityTabs' merge).
  const enCoursCount = enCours.length + enAttente.length;
  const termineesCount = gagnees.length + participees.length;
  const favorisCount = favoris.length;

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 pt-4 pb-16 lg:max-w-4xl lg:px-6 lg:pt-9 lg:pb-24">
      <FocusRowHighlight idPrefix="act-" />

      {/* ── Header — compact on mobile, a proper page masthead on desktop
          with the seller-space action pulled up to the top-right. ── */}
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-6">
        <div>
          <span className="batta-eyebrow">Côté acheteur</span>
          <h1 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight lg:text-[36px]">
            Mes achats
          </h1>
          <p className="mt-1.5 text-[12px] text-muted lg:text-[14px]">
            Enchères, acquisitions et favoris.
          </p>
        </div>
        <Link
          href="/sell"
          className="hidden shrink-0 items-center gap-2.5 rounded-2xl bg-surface px-4 py-3 ring-1 ring-border transition hover:ring-gold-soft/50 lg:inline-flex"
        >
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/30">
            <Building2 className="size-4" strokeWidth={2} />
          </span>
          <span className="text-start">
            <span className="block text-[13px] font-bold leading-tight text-foreground">
              Espace vendeur
            </span>
            <span className="block text-[11px] text-muted">Annonces · revenus · retraits</span>
          </span>
          <ArrowUpRight className="size-4 text-muted" strokeWidth={2.2} />
        </Link>
      </div>

      {/* ── Desktop summary strip — three at-a-glance counts. Gives the wide
          viewport substance instead of a lonely narrow column. ── */}
      <div className="mt-7 hidden grid-cols-3 gap-4 lg:grid">
        <StatCard label="En cours" value={enCoursCount} Icon={Gavel} tone="text-gold" />
        <StatCard label="Terminées" value={termineesCount} Icon={History} tone="text-foreground/70" />
        <StatCard label="Favoris" value={favorisCount} Icon={Heart} tone="text-red-500" />
      </div>

      <ActivityTabs
        enCours={enCours}
        enAttente={enAttente}
        gagnees={gagnees}
        participees={participees}
        favoris={favoris}
        locale={locale}
        initialTab={initialTab}
      />

      {/* Mobile-only seller nudge (desktop shows the header action instead). */}
      <Link
        href="/sell"
        className="mt-2 flex items-center gap-3 rounded-xl bg-surface p-4 ring-1 ring-border transition hover:ring-gold-soft/40 lg:hidden"
      >
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/30">
          <Building2 className="size-5" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-foreground">Vous vendez aussi ?</div>
          <div className="mt-0.5 text-[11.5px] text-muted">
            Annonces, revenus et retraits.
          </div>
        </div>
        <ChevronEnd className="size-5 text-muted" />
      </Link>
    </div>
  );
}

/** Desktop summary tile — icon + big count + label. */
function StatCard({
  label,
  value,
  Icon,
  tone,
}: {
  label: string;
  value: number;
  Icon: typeof Gavel;
  tone: string;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl bg-surface p-5 ring-1 ring-border">
      <span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 ring-1 ring-border ${tone}`}>
        <Icon className="size-5" strokeWidth={2.2} />
      </span>
      <div>
        <div className="batta-tabular text-[26px] font-extrabold leading-none text-foreground">
          {value}
        </div>
        <div className="mt-1 text-[12px] font-semibold text-muted">{label}</div>
      </div>
    </div>
  );
}
