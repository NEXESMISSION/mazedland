import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPager } from "@/components/admin/AdminPager";
import { adminBtn } from "@/components/admin/AdminButton";
import { FullBleed, Toolbar, EmptyState, QueueKeys, type Tab } from "@/components/admin/kit";
import { QueueList, type QueueRow } from "./QueueList";
import { ListingDetail, type PanelListing } from "./ListingDetail";
import { formatTND } from "@/lib/utils";
import { Inbox, Plus } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Annonces — the console's core screen.
 *
 * What changed from the first version: the moderation queue no longer renders
 * a 421-line creation form above itself (it moved to `/admin/annonces/nouvelle`,
 * where it does not compete with the list you came for), it pages server-side
 * instead of pulling 120 rows with every photo attached, and the detail opens
 * in a drawer keyed off `?panel=` rather than expanding the row and reflowing
 * the list under the cursor.
 *
 * The tab order is the order the work matters in, not the order the enum is
 * declared in: what a seller is waiting on first, what we are about to lose
 * second, everything else after.
 */

const PAGE_SIZE = 25;
const EXPIRING_DAYS = 7;

type TabKey =
  | "pending_review" | "pending_payment" | "published"
  | "expiring" | "expired" | "rejected" | "all";

const TAB_LABEL: Record<TabKey, string> = {
  pending_review: "À valider",
  pending_payment: "Paiement attendu",
  published: "En ligne",
  expiring: "Expirent bientôt",
  expired: "Expirées",
  rejected: "Refusées",
  all: "Toutes",
};
const TAB_ORDER: TabKey[] = [
  "pending_review", "pending_payment", "published", "expiring", "expired", "rejected", "all",
];

/**
 * A tab, expressed as data rather than as a function over the query builder.
 *
 * The obvious version — a generic `applyTab(query, tab)` — makes TypeScript
 * re-infer PostgREST's builder type at every chained call and it gives up
 * ("type instantiation is excessively deep"). Describing the filters and
 * applying them in a plain loop keeps one definition shared by the counts and
 * the list, so a tab can never count one thing and list another.
 */
type Filter =
  | { op: "eq"; col: string; val: string }
  | { op: "gte" | "lte"; col: string; val: string }
  | { op: "notNull"; col: string };

function tabFilters(tab: TabKey): Filter[] {
  const now = new Date();
  const soon = new Date(now.getTime() + EXPIRING_DAYS * 86_400_000);
  switch (tab) {
    case "expiring":
      return [
        { op: "eq", col: "status", val: "published" },
        { op: "notNull", col: "expires_at" },
        { op: "gte", col: "expires_at", val: now.toISOString() },
        { op: "lte", col: "expires_at", val: soon.toISOString() },
      ];
    case "all":
      return [];
    default:
      return [{ op: "eq", col: "status", val: tab }];
  }
}

const LIST_SELECT = `
  id, title, price, negotiable, price_on_request, governorate, status,
  created_at, published_at, expires_at,   seller_credit_id, fee_payment_id, fee_waived_by, contact_phone,
  seller:profiles!listings_seller_id_fkey (full_name, phone),
  category:categories (label_fr),
  photos:listing_photos (storage_path, sort_order, is_cover)
`;

export default async function AdminAnnoncesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; a?: string }>;
}) {
  const sp = await searchParams;
  const admin = getServiceSupabase();

  if (!admin) {
    return <p className="text-[13px] text-muted">Service non configuré.</p>;
  }

  const tab: TabKey = TAB_ORDER.includes(sp.status as TabKey)
    ? (sp.status as TabKey)
    : "pending_review";
  // PostgREST `or()` takes a comma-separated filter string, so the characters
  // that delimit it have to leave the search term or they change the query.
  const q = (sp.q ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  // Reference first, and normalised: someone reading a code off a note types
  // "42", "mz-42" or "MZ 00042" — all of which mean MZ-00042. The raw term is
  // still matched too, so a partial like "MZ-001" keeps working as a prefix.
  const digits = q.replace(/\D/g, "");
  const asRef = digits ? `MZ-${digits.padStart(5, "0")}` : "";
  const OR = [
    `reference.ilike.%${q}%`,
    ...(asRef ? [`reference.eq.${asRef}`] : []),
    `title.ilike.%${q}%`,
    `contact_phone.ilike.%${q}%`,
    `governorate.ilike.%${q}%`,
  ].join(",");

  /**
   * All seven tab counts in ONE round trip.
   *
   * The obvious implementation is seven head-only COUNTs, and that is what
   * this was. Each one is a separate HTTP request to PostgREST at ~75 ms, so
   * the tab strip alone cost more than the page it labels — on every click,
   * every keystroke of the debounced search, and every filter change.
   *
   * Two columns for every matching row is a far smaller payload than it
   * sounds (66 rows today; ~40 bytes each), and the counting is free. The
   * ceiling is real but distant: past roughly 50 000 listings this should
   * become a `group by status` RPC. It is one query either way — the point is
   * that it stops being seven.
   */
  const countsQuery = () => {
    let query = admin.from("listings").select("status, expires_at");
    if (q) query = query.or(OR);
    return query;
  };

  const listQuery = () => {
    let query = admin.from("listings").select(LIST_SELECT, { count: "exact" });
    for (const f of tabFilters(tab)) {
      if (f.op === "eq") query = query.eq(f.col, f.val);
      else if (f.op === "gte") query = query.gte(f.col, f.val);
      else if (f.op === "lte") query = query.lte(f.col, f.val);
      else query = query.not(f.col, "is", null);
    }
    if (q) query = query.or(OR);
    return query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  };

  const [countsRes, listRes] = await Promise.all([countsQuery(), listQuery()]);

  // One pass over the statuses fills every tab. `expiring` is the only tab
  // that is not just a status, so it is the only one that needs the date.
  const now = Date.now();
  const soonMs = now + EXPIRING_DAYS * 86_400_000;
  const tally: Record<TabKey, number> = {
    pending_review: 0, pending_payment: 0, published: 0,
    expiring: 0, expired: 0, rejected: 0, all: 0,
  };
  for (const row of (countsRes.data ?? []) as { status: string; expires_at: string | null }[]) {
    tally.all += 1;
    if (row.status in tally) tally[row.status as TabKey] += 1;
    if (row.status === "published" && row.expires_at) {
      const t = new Date(row.expires_at).getTime();
      if (t >= now && t <= soonMs) tally.expiring += 1;
    }
  }

  const tabs: Tab[] = TAB_ORDER.map((t) => ({
    value: t,
    label: TAB_LABEL[t],
    count: tally[t],
  }));

  type ListRow = {
    id: string; reference: string | null; title: string; price: number | null; negotiable: boolean;
    price_on_request: boolean; governorate: string; status: string;
    created_at: string; published_at: string | null; expires_at: string | null;
    seller_credit_id: string | null; fee_payment_id: string | null;
    fee_waived_by: string | null; contact_phone: string | null;
    seller: { full_name: string | null; phone: string | null } | null;
    category: { label_fr: string } | null;
    photos: { storage_path: string; sort_order: number; is_cover: boolean }[] | null;
  };

  const rows = (listRes.data ?? []) as unknown as ListRow[];
  const total = listRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const queueRows: QueueRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    meta: `${r.seller?.full_name ?? "Sans nom"} · ${r.category?.label_fr ?? "—"} · ${r.governorate}`,
    // Also as separate fields: at full width the queue lays these out as
    // columns instead of one stretched line (see QueueList).
    seller: r.seller?.full_name ?? "Sans nom",
    category: r.category?.label_fr ?? "—",
    gov: r.governorate,
    value: r.price_on_request
      ? "Sur demande"
      : r.price != null
        ? `${formatTND(r.price, "fr")} TND`
        : "—",
    hint: ageLabel(r.status === "published" ? r.expires_at : r.created_at, r.status),
    status: r.status,
    // Flag what needs a human before it can move: an annonce with no phone can
    // never be published, and one waiting on money is waiting on us to look.
    flag:
      r.status === "pending_review" && !r.contact_phone
        ? "bad"
        : r.status === "pending_payment"
          ? "warn"
          : undefined,
  }));

  // The open annonce. Fetched only when asked for — the list query has no
  // business carrying every attribute of every row.
  const openId = sp.a ?? null;
  const detail = openId ? await loadPanel(admin, openId) : null;

  // Current filters, as a prefix a row can append its own id to.
  const base = new URLSearchParams();
  if (sp.status) base.set("status", sp.status);
  if (sp.q) base.set("q", sp.q);
  if (sp.page) base.set("page", sp.page);
  const hrefBase = `/admin/annonces?${base.toString()}${base.toString() ? "&" : ""}`;
  const listHref = `/admin/annonces${base.toString() ? `?${base.toString()}` : ""}`;

  return (
    <FullBleed>
      {/* One header line: what this is, what is filtered, what you can add. */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
          Annonces
        </h1>
        <Toolbar
          tabs={tabs}
          defaultTab="pending_review"
          searchPlaceholder="Référence MZ-00042, titre, téléphone…"
          resetParams={["page", "a"]}
        />
        <Link href="/admin/annonces/nouvelle" className={`${adminBtn("primary", "sm")} shrink-0`}>
          <Plus className="size-3.5" strokeWidth={2.8} />
          <span className="hidden sm:inline">Créer</span>
        </Link>
      </header>

      <QueueKeys />

      <div className="flex min-h-0 flex-1">
        {/* Left pane — the queue. Below lg it is the whole screen until an
            annonce is opened, because there is no room for two panes. */}
        {/* The queue was a fixed 360/400px column whatever the screen, so with
            nothing selected a 1900px display showed a narrow strip of rows and
            fifteen hundred pixels of "Choisissez une annonce à gauche". The
            list now takes the whole width until something IS selected, and
            only then narrows to make room for the annonce. */}
        <div
          className={`flex min-h-0 flex-col border-border ${
            detail
              ? "hidden w-full lg:flex lg:w-[360px] lg:shrink-0 lg:border-e xl:w-[400px]"
              : "flex w-full"
          }`}
        >
          {queueRows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                Icon={Inbox}
                tone={q ? "filtered" : "idle"}
                title={q ? "Aucune annonce ne correspond" : `Rien dans « ${TAB_LABEL[tab]} »`}
                hint={
                  q
                    ? "Essayez un autre terme, ou changez d'onglet."
                    : "Rien n'attend de décision dans cette file."
                }
              />
            </div>
          ) : (
            <QueueList rows={queueRows} selectedId={openId} hrefBase={hrefBase} wide={!detail} />
          )}

          {totalPages > 1 && (
            <div className="shrink-0 border-t border-border px-4 py-2">
              <AdminPager page={page} totalPages={totalPages} />
            </div>
          )}
        </div>

        {/* Right pane — the annonce. */}
        {/* Only exists once there is something to put in it. */}
        {detail && (
          <div className="flex min-w-0 flex-1">
            <div className="w-full">
              <ListingDetail listing={detail} backHref={listHref} />
            </div>
          </div>
        )}
      </div>
    </FullBleed>
  );
}

/** "il y a 3 j" for what is waiting, "expire dans 5 j" for what is live. */
function ageLabel(iso: string | null, status: string): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - Date.now();
  const days = Math.round(Math.abs(diff) / 86_400_000);
  if (status === "published") {
    if (diff < 0) return "expirée";
    return days === 0 ? "aujourd'hui" : `dans ${days} j`;
  }
  if (days === 0) return "aujourd'hui";
  return `il y a ${days} j`;
}

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * Everything the drawer shows, for one annonce.
 *
 * The attribute labels are resolved here against `category_attributes` rather
 * than shipped as raw jsonb keys: a moderator reading `boite: auto` has to
 * translate it in their head, and `attributes` holds field keys, not labels.
 */
async function loadPanel(admin: Admin, id: string): Promise<PanelListing | null> {
  const { data } = await admin
    .from("listings")
    .select(
      `id, title, description, price, negotiable, price_on_request,
       governorate, delegation, status, rejection_reason, category_id,
       contact_name, contact_phone, show_phone, attributes,
       created_at, published_at, expires_at,        view_count, contact_reveal_count, renewed_count,
       seller_attestation_version, seller_attestation_at,
       seller_credit_id, fee_payment_id, fee_waived_by,
       seller:profiles!listings_seller_id_fkey (full_name, phone),
       category:categories (label_fr, kind),
       photos:listing_photos (storage_path, sort_order, is_cover)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;
  const r = data as unknown as {
    id: string; reference: string | null; title: string; description: string | null; price: number | null;
    negotiable: boolean; price_on_request: boolean;
    governorate: string; delegation: string | null; status: string;
    rejection_reason: string | null; category_id: string;
    contact_name: string | null; contact_phone: string | null; show_phone: boolean;
    attributes: Record<string, unknown>;
    created_at: string; published_at: string | null; expires_at: string | null;
    view_count: number; contact_reveal_count: number; renewed_count: number;
    seller_attestation_version: string | null; seller_attestation_at: string | null;
    seller_credit_id: string | null; fee_payment_id: string | null; fee_waived_by: string | null;
    seller: { full_name: string | null; phone: string | null } | null;
    category: { label_fr: string; kind: string } | null;
    photos: { storage_path: string; sort_order: number; is_cover: boolean }[] | null;
  };

  const [attrRes, payRes] = await Promise.all([
    admin
      .from("category_attributes")
      .select("field_key, label, unit, options, sort_order")
      .eq("category_id", r.category_id)
      .order("sort_order"),
    r.fee_payment_id
      ? admin
          .from("payments")
          .select("amount, status, kind, receipt_uploaded_at")
          .eq("id", r.fee_payment_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  type Attr = {
    field_key: string; label: string; unit: string | null;
    options: { value: string; label: string }[] | null;
  };
  const defs = (attrRes.data ?? []) as Attr[];
  const attributes = defs
    .map((d) => {
      const raw = r.attributes?.[d.field_key];
      if (raw == null || raw === "") return null;
      // Options carry their own display label; a select stored as `auto`
      // should read "Automatique", not "auto".
      const opt = d.options?.find((o) => o.value === String(raw));
      const value = opt?.label ?? (typeof raw === "boolean" ? (raw ? "Oui" : "Non") : String(raw));
      return { label: d.label, value: d.unit ? `${value} ${d.unit}` : value };
    })
    .filter((a): a is { label: string; value: string } => a !== null);

  const pay = payRes.data as
    | { amount: number; status: string; kind: string; receipt_uploaded_at: string | null }
    | null;

  const paidWith: PanelListing["paidWith"] = r.fee_waived_by
    ? "waived"
    : r.seller_credit_id
      ? "credit"
      : r.fee_payment_id
        ? "payment"
        : "none";

  const photos = [...(r.photos ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((p) => ({ path: p.storage_path, isCover: p.is_cover }));

  return {
    id: r.id,
    title: r.title,
    description: r.description,
    price: r.price,
    negotiable: r.negotiable,
    priceOnRequest: r.price_on_request,
    governorate: r.governorate,
    delegation: r.delegation,
    status: r.status,
    rejectionReason: r.rejection_reason,
    categoryLabel: r.category?.label_fr ?? "—",
    categoryKind: r.category?.kind ?? "vehicle",
    sellerName: r.seller?.full_name ?? "Sans nom",
    sellerPhone: r.seller?.phone ?? null,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    showPhone: r.show_phone,
    attributes,
    photos,
    createdAt: r.created_at,
    publishedAt: r.published_at,
    expiresAt: r.expires_at,
    viewCount: r.view_count,
    contactRevealCount: r.contact_reveal_count,
    renewedCount: r.renewed_count,
    attestation: r.seller_attestation_version
      ? { version: r.seller_attestation_version, at: r.seller_attestation_at }
      : null,
    payment: pay
      ? {
          amount: Number(pay.amount),
          status: pay.status,
          kind: pay.kind,
          uploadedAt: pay.receipt_uploaded_at,
        }
      : null,
    paidWith,
  };
}
