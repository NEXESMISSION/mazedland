import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { formatTND } from "@/lib/utils";
import {
  ChevronRight, ImageOff, Image as ImageIcon, FileText, Wallet,
  MapPin, Calendar, User, Gavel, Tag,
  ReceiptText, ShieldCheck, ClipboardCheck, CheckCircle2,
} from "lucide-react";
import { ApprovePropertyButtons } from "@/components/admin/ApprovePropertyButtons";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAY: Record<string, { label: string; tone: string }> = {
  pending: { label: "Reçu en attente", tone: "batta-tone-warn" },
  pending_review: { label: "Reçu à vérifier", tone: "batta-tone-warn" },
  captured: { label: "Payé", tone: "batta-tone-ok" },
  failed: { label: "Refusé", tone: "batta-tone-bad" },
  cancelled: { label: "Annulé", tone: "bg-surface-2 text-muted ring-1 ring-border" },
};

const TABS = [
  { key: "pending_review", label: "À valider" },
  { key: "rejected",       label: "Refusées" },
  { key: "ready",          label: "Validées" },
  { key: "sold",           label: "Vendues" },
  { key: "all",            label: "Toutes" },
] as const;

const TAB_LABEL: Record<string, string> = Object.fromEntries(
  TABS.map((t) => [t.key, t.label]),
);

type Row = {
  id: string;
  title: string;
  governorate: string;
  type: string;
  status: string;
  created_at: string;
  rejection_reason: string | null;
  listing_type: string | null;
  sale_price: number | null;
  area_sqm: number | null;
  photos: { storage_path: string; sort_order: number }[];
  documents: { id: string }[];
  owner: { full_name: string | null } | { full_name: string | null }[] | null;
};

export default async function AdminProperties({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const supabase = await getServerSupabase();
  const { status: statusRaw } = await searchParams;

  // Default to the only view that's truly actionable. The old "no
  // filter → all statuses" behaviour produced a wall of "—" rows
  // because the action column is blank for ready/rejected listings.
  // `?status=all` is the explicit escape hatch when the admin wants
  // the full archive view.
  const VALID = new Set(["pending_review", "ready", "rejected", "sold", "all"]);
  const status = statusRaw && VALID.has(statusRaw) ? statusRaw : "pending_review";

  let query = supabase
    .from("properties")
    .select(`
      id, title, governorate, type, status, created_at, rejection_reason,
      listing_type, sale_price, area_sqm,
      photos:property_photos (storage_path, sort_order),
      documents:property_documents (id),
      owner:profiles!properties_owner_id_fkey (full_name)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  if (status === "pending_review" || status === "ready" || status === "rejected") {
    query = query.eq("status", status);
  } else if (status === "sold") {
    // "Vendues" = properties whose auction ended sold/awarded.
    const { data: soldAuc } = await supabase
      .from("auctions").select("property_id").in("status", ["ended_sold", "awarded"]);
    const soldIds = (soldAuc ?? []).map((a) => a.property_id).filter(Boolean) as string[];
    query = query.in("id", soldIds.length > 0 ? soldIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  // status === "all" → no .eq filter, returns everything.

  // Count rows for the tab strip — done in parallel with the row fetch.
  const countQ = (col: "status" | null, val: string | null) => {
    let q = supabase.from("properties").select("*", { count: "exact", head: true });
    if (col && val) q = q.eq(col, val);
    return q;
  };
  const [pendingC, rejectedC, readyC] = await Promise.all([
    countQ("status", "pending_review"),
    countQ("status", "rejected"),
    countQ("status", "ready"),
  ]);
  const tabCounts = {
    pending_review: pendingC.count ?? 0,
    rejected: rejectedC.count ?? 0,
    ready: readyC.count ?? 0,
  };

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  // Latest listing-fee payment per property → receipt/payment status inline.
  const ids = rows.map((r) => r.id);
  const payByProp = new Map<string, { status: string; amount: number; receipt_url: string | null }>();
  if (ids.length > 0) {
    const { data: pays } = await supabase
      .from("payments")
      .select("property_id, status, amount, receipt_url, created_at")
      .in("property_id", ids)
      .eq("kind", "listing_fee")
      .order("created_at", { ascending: false });
    for (const p of pays ?? []) {
      const pid = p.property_id as string;
      if (!payByProp.has(pid)) {
        payByProp.set(pid, {
          status: p.status as string,
          amount: Number(p.amount),
          receipt_url: (p.receipt_url as string | null) ?? null,
        });
      }
    }
  }

  const pendingCount = rows.filter((r) => r.status === "pending_review").length;

  // Cross-queue "needs action" summary — folded in from the old Overview so
  // the admin starts here and sees everything that needs a decision. Only
  // the non-property queues (the property queue itself is right below).
  const [recRes, kycRes, payoutRes, inspRes] = await Promise.all([
    supabase.from("payments").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase.from("kyc_submissions").select("*", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("seller_payouts").select("*", { count: "exact", head: true }).in("status", ["requested", "processing"]),
    supabase.from("inspectors").select("*", { count: "exact", head: true }).eq("approved", false),
  ]);
  const actions = [
    { label: "Reçus à vérifier", value: recRes.count ?? 0, href: "/admin/payments" as const, Icon: ReceiptText },
    { label: "KYC à vérifier", value: kycRes.count ?? 0, href: "/admin/kyc-queue" as const, Icon: ShieldCheck },
    { label: "Retraits à traiter", value: payoutRes.count ?? 0, href: "/admin/payouts" as const, Icon: Wallet },
    { label: "Inspecteurs à approuver", value: inspRes.count ?? 0, href: "/admin/inspectors" as const, Icon: ClipboardCheck },
  ].filter((a) => a.value > 0);

  return (
    <div>
      <span className="batta-eyebrow">Consignment queue</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">
          Properties
        </h2>
        {pendingCount > 0 && (
          <span className="shrink-0 rounded-full batta-tone-warn px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.14em]">
            {pendingCount} à valider
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-muted">
        Tout est ici : photos, prix, documents et reçu. Validez ou refusez sans
        changer de page.
      </p>

      {/* Cross-queue action summary (folded in from the old Overview). */}
      <section className="mt-5">
        <h3 className="batta-eyebrow mb-2 flex items-center gap-2">
          <span aria-hidden className="batta-gold-rule-short" />
          Action requise
        </h3>
        {actions.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-2xl bg-surface p-3.5 text-[12.5px] text-muted ring-1 ring-border">
            <CheckCircle2 className="size-4 text-emerald-500" />
            Aucune autre file en attente — il ne reste que les annonces ci-dessous.
          </div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {actions.map(({ label, value, href, Icon }) => (
              <li key={label}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-2xl bg-gold-faint p-3.5 ring-1 ring-gold/30 transition hover:ring-gold/60"
                >
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--gold)] text-white">
                    <Icon className="size-4" strokeWidth={2} />
                  </span>
                  <span className="flex-1 text-[13px] font-bold text-foreground">{label}</span>
                  <span className="batta-tabular inline-flex min-w-7 items-center justify-center rounded-full bg-[var(--gold)] px-2 py-0.5 text-[12px] font-extrabold text-white">
                    {value}
                  </span>
                  <ChevronRight className="size-4 text-gold" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h3 className="batta-eyebrow mb-2 mt-6 flex items-center gap-2">
        <span aria-hidden className="batta-gold-rule-short" />
        Annonces · {TAB_LABEL[status] ?? status}
      </h3>

      {/* Filter tabs. Default tab is "À valider" so admins land on
          actionable rows; the others are reachable but never the
          first thing the queue dumps on them. */}
      <nav className="-mx-1 mb-3 flex flex-wrap gap-1.5 overflow-x-auto px-1">
        {TABS.map((t) => {
          const active = status === t.key;
          const count = (tabCounts as Record<string, number | undefined>)[t.key];
          return (
            <Link
              key={t.key}
              href={`/admin/properties?status=${t.key}` as `/admin/properties?status=${string}`}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold ring-1 transition ${
                active
                  ? "bg-[var(--gold)] text-white ring-[var(--gold)]"
                  : "bg-surface text-muted ring-border hover:ring-gold-soft/50 hover:text-foreground"
              }`}
            >
              {t.label}
              {count != null && count > 0 && (
                <span
                  className={`batta-tabular inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-extrabold ${
                    active
                      ? "bg-white/25 text-white"
                      : "bg-surface-2 text-foreground/85"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ─── Desktop table — lg+ only. Mobile keeps the card list
              below. The table fits owner / location / price /
              payment / status on a single row so the admin gets the
              whole queue at a glance instead of scrolling card by
              card. */}
      <div className="hidden overflow-hidden rounded-2xl bg-surface ring-1 ring-border lg:block">
        <table className="w-full text-[12.5px]">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-[0.14em] text-muted">
            <tr>
              <th className="px-3 py-2.5 text-start font-extrabold">Annonce</th>
              <th className="px-3 py-2.5 text-start font-extrabold">Vendeur</th>
              <th className="px-3 py-2.5 text-start font-extrabold">Localisation</th>
              <th className="px-3 py-2.5 text-start font-extrabold">Type</th>
              <th className="px-3 py-2.5 text-end font-extrabold">Mise / prix</th>
              <th className="px-3 py-2.5 text-start font-extrabold">Reçu</th>
              <th className="px-3 py-2.5 text-start font-extrabold">Statut</th>
              <th className="px-3 py-2.5 text-end font-extrabold">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((p) => {
              const photos = (p.photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
              const cover = photos[0];
              const docCount = (p.documents ?? []).length;
              const ownerName = Array.isArray(p.owner) ? p.owner[0]?.full_name : p.owner?.full_name;
              const pay = payByProp.get(p.id);
              const isDirect = p.listing_type === "direct";
              const detailHref = `/admin/properties/${p.id}` as `/admin/properties/${string}`;
              return (
                <tr key={`row-${p.id}`} className="transition hover:bg-surface-2/60">
                  <td className="px-3 py-2.5">
                    <Link href={detailHref} className="flex items-center gap-2.5">
                      <div className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                        {cover ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={propertyPhotoUrl(cover.storage_path)} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-muted">
                            <ImageOff className="size-4" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="line-clamp-1 font-bold text-foreground group-hover:text-gold-bright">
                          {p.title}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted">
                          <Calendar className="size-2.5" />
                          {new Date(p.created_at).toLocaleDateString("fr-FR")}
                          <span aria-hidden className="opacity-40">·</span>
                          <FileText className="size-2.5" />
                          {docCount} doc{docCount > 1 ? "s" : ""}
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 text-foreground/85">
                    {ownerName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <User className="size-3 text-gold" />
                        <span className="line-clamp-1 max-w-[14ch]">{ownerName}</span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-foreground/85">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3 text-muted" />
                      {p.governorate}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2 py-0.5 text-[10px] font-bold text-gold-bright ring-1 ring-gold/25">
                      {isDirect ? <Tag className="size-2.5" /> : <Gavel className="size-2.5" />}
                      {isDirect ? "Direct" : "Enchère"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    {isDirect && p.sale_price != null ? (
                      <span className="batta-tabular font-bold text-foreground">
                        {formatTND(Number(p.sale_price), "fr")}{" "}
                        <span className="text-[10px] font-bold uppercase text-muted">TND</span>
                      </span>
                    ) : p.area_sqm != null ? (
                      <span className="batta-tabular text-foreground/85">
                        {p.area_sqm} m²
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {pay ? (
                      <span className="flex flex-col gap-0.5">
                        <span className="batta-tabular text-[11px] font-bold text-foreground">
                          {formatTND(pay.amount, "fr")} TND
                        </span>
                        <span
                          className={`inline-flex w-fit rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em] ${
                            PAY[pay.status]?.tone ?? "bg-surface-2 text-muted ring-1 ring-border"
                          }`}
                        >
                          {PAY[pay.status]?.label ?? pay.status}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={p.status} />
                    {p.rejection_reason && p.status === "rejected" && (
                      <div className="mt-1 line-clamp-1 max-w-[18ch] text-[10px] text-[var(--danger)]">
                        {p.rejection_reason}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-end">
                    <div className="flex justify-end">
                      <ApprovePropertyButtons id={p.id} status={p.status} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-6 py-10 text-center text-[13px] text-muted">
                  No properties submitted yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 lg:hidden">
        {rows.map((p) => {
          const photos = (p.photos ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);
          const cover = photos[0];
          const docCount = (p.documents ?? []).length;
          const ownerName = Array.isArray(p.owner)
            ? p.owner[0]?.full_name
            : p.owner?.full_name;
          const pay = payByProp.get(p.id);
          const isDirect = p.listing_type === "direct";
          const detailHref = `/admin/properties/${p.id}` as `/admin/properties/${string}`;

          return (
            <div
              key={p.id}
              className="overflow-hidden rounded-2xl bg-surface ring-1 ring-border transition-all hover:ring-gold-soft/40"
            >
              <Link href={detailHref} className="flex gap-3 p-3">
                {/* Cover */}
                <div className="relative size-24 shrink-0 overflow-hidden rounded-xl bg-surface-2">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={propertyPhotoUrl(cover.storage_path)}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted">
                      <ImageOff className="size-5" />
                    </div>
                  )}
                  {photos.length > 1 && (
                    <span className="absolute bottom-1 right-1 inline-flex items-center gap-0.5 rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      <ImageIcon className="size-2.5" /> {photos.length}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate text-[14px] font-bold text-foreground">
                      {p.title}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <StatusPill status={p.status} />
                      <ChevronRight className="size-4 text-muted" />
                    </div>
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-muted">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" /> {p.governorate}
                    </span>
                    <span className="uppercase tracking-[0.12em]">{p.type}</span>
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />
                      {new Date(p.created_at).toLocaleDateString("fr-FR")}
                    </span>
                  </div>

                  {/* Chips: listing type + price, owner, docs */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gold-faint px-2 py-0.5 text-[10px] font-bold text-gold-bright ring-1 ring-gold/25">
                      {isDirect ? <Tag className="size-2.5" /> : <Gavel className="size-2.5" />}
                      {isDirect ? "Offre directe" : "Enchère"}
                    </span>
                    {isDirect && p.sale_price != null && (
                      <span className="batta-tabular rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-foreground ring-1 ring-border">
                        {formatTND(Number(p.sale_price), "fr")} TND
                      </span>
                    )}
                    {p.area_sqm != null && (
                      <span className="batta-tabular rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-foreground/85 ring-1 ring-border">
                        {p.area_sqm} m²
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-foreground/85 ring-1 ring-border">
                      <FileText className="size-2.5" /> {docCount} doc{docCount > 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Owner + payment */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
                    {ownerName && (
                      <span className="inline-flex items-center gap-1 text-muted">
                        <User className="size-3 text-gold" /> {ownerName}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5">
                      <Wallet className="size-3 text-gold" />
                      {pay ? (
                        <>
                          <span className="batta-tabular font-semibold text-foreground">
                            {formatTND(pay.amount, "fr")} TND
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-[0.1em] ${
                              PAY[pay.status]?.tone ?? "bg-surface-2 text-muted ring-1 ring-border"
                            }`}
                          >
                            {PAY[pay.status]?.label ?? pay.status}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">Aucun paiement</span>
                      )}
                    </span>
                  </div>

                  {p.rejection_reason && (
                    <div className="batta-tone-bad mt-2 rounded-md px-2 py-1 text-[10.5px]">
                      {p.rejection_reason}
                    </div>
                  )}
                </div>
              </Link>

              {/* Decision footer */}
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5">
                <Link
                  href={detailHref}
                  className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted hover:text-gold-bright"
                >
                  Examiner en détail →
                </Link>
                <ApprovePropertyButtons id={p.id} status={p.status} />
              </div>
            </div>
          );
        })}

        {rows.length === 0 && (
          <div className="batta-frame-gold relative px-6 py-10 text-center text-[13px] text-muted">
            No properties submitted yet.
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "ready" ? "batta-tone-ok"
    : status === "pending_review" ? "batta-tone-warn"
    : status === "rejected" ? "batta-tone-bad"
    : "bg-surface-2 text-muted ring-1 ring-border";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
      {status}
    </span>
  );
}
