import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPager } from "@/components/admin/AdminPager";
import {
  FullBleed, Toolbar, EmptyState, QueueKeys, StatusPill, type Tab,
} from "@/components/admin/kit";
import { ROW_BASE, ROW_IDLE, ROW_SELECTED, ROW_FOCUS } from "@/components/admin/kit/surface";
import { SellerDetail, type SellerDetailData } from "./SellerDetail";
import { Users, BadgeCheck } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Vendeurs — accounts, roles, badges, credits and bans in one place.
 *
 * Merges `/admin/users` (a list with a role dropdown) and `/admin/sellers`
 * (packs and badges). They were two screens answering one question: who is
 * this person, and what are they allowed to do?
 */

const PAGE_SIZE = 30;

type TabKey = "all" | "agency" | "verified" | "banned";

const TAB_LABEL: Record<TabKey, string> = {
  all: "Tous",
  agency: "Agences",
  verified: "Vérifiés",
  banned: "Suspendus",
};
const TAB_ORDER: TabKey[] = ["all", "agency", "verified", "banned"];

export default async function AdminVendeursPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; a?: string }>;
}) {
  const sp = await searchParams;
  const admin = getServiceSupabase();
  if (!admin) return <p className="text-[13px] text-muted">Service non configuré.</p>;

  const tab: TabKey = TAB_ORDER.includes(sp.status as TabKey) ? (sp.status as TabKey) : "all";
  const q = (sp.q ?? "").trim().slice(0, 60).replace(/[,()*%]/g, " ").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const nowIso = new Date().toISOString();

  /**
   * "Vérifié" is a join, not an id list.
   *
   * The first version read every live badge, built a Map of seller ids, and
   * fed it to `.in("id", [...])` — which is an unbounded IN clause in the URL,
   * and a second unbounded read to build it. Fine at three badges, a broken
   * request at three thousand. The embedded join makes Postgres do the work
   * and keeps the page's payload proportional to the page size.
   *
   * The `!seller_badges_seller_id_fkey` hint is load-bearing, not decoration.
   * `seller_badges` points at `profiles` TWICE — `seller_id` (who holds it)
   * and `granted_by` (which admin issued it) — so a bare `seller_badges(...)`
   * is ambiguous and PostgREST refuses the whole request with
   * `Could not embed because more than one relationship was found`. Naming the
   * constraint picks the one that means "this person's badge".
   *
   * It failed silently for exactly the reason `is_cover` did: the page still
   * answers 200, because a React Server Component streams its shell before the
   * query runs. The list simply came back empty forever. Both of those bugs
   * were found by running the query against the live database rather than by
   * loading the page — which is the only test that catches this shape.
   */
  const listQuery = () => {
    let query =
      tab === "verified"
        ? admin
            .from("profiles")
            .select(
              "id, full_name, phone, role, governorate, created_at, banned_at, seller_badges!seller_badges_seller_id_fkey!inner(expires_at, revoked_at)",
              { count: "exact" },
            )
            .is("deleted_at", null)
            .is("seller_badges.revoked_at", null)
            .gt("seller_badges.expires_at", nowIso)
        : admin
            .from("profiles")
            .select(
              "id, full_name, phone, role, governorate, created_at, banned_at, seller_badges!seller_badges_seller_id_fkey(expires_at, revoked_at)",
              { count: "exact" },
            )
            .is("deleted_at", null);

    if (tab === "agency") query = query.eq("role", "agency");
    if (tab === "banned") query = query.not("banned_at", "is", null);
    if (q) query = query.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);

    return query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  };

  /**
   * Tab counts as four head-only COUNTs rather than one full table read.
   *
   * This used to `select id, role, banned_at` for EVERY profile and tally in
   * JS — the same mistake the seller picker made, and the reason it is worth
   * naming: at 23 accounts you cannot see it, and at 50 000 the page moves
   * 50 000 rows to render a number. Head-only counts transfer no rows at all,
   * and the four run in parallel.
   */
  const head = () => admin.from("profiles").select("id", { count: "exact", head: true }).is("deleted_at", null);

  const [allRes, agencyRes, bannedRes, verifiedRes, listRes] = await Promise.all([
    head(),
    head().eq("role", "agency"),
    head().not("banned_at", "is", null),
    admin
      .from("seller_badges")
      .select("seller_id", { count: "exact", head: true })
      .is("revoked_at", null)
      .gt("expires_at", nowIso),
    listQuery(),
  ]);

  const counts: Record<TabKey, number> = {
    all: allRes.count ?? 0,
    agency: agencyRes.count ?? 0,
    verified: verifiedRes.count ?? 0,
    banned: bannedRes.count ?? 0,
  };
  const tabs: Tab[] = TAB_ORDER.map((t) => ({ value: t, label: TAB_LABEL[t], count: counts[t] }));

  type ProfileRow = {
    id: string; full_name: string | null; phone: string | null; role: string;
    governorate: string | null; created_at: string; banned_at: string | null;
    seller_badges?: { expires_at: string; revoked_at: string | null }[] | null;
  };

  /** A badge counts only if it was never revoked and has not lapsed — both
   *  tests live on the row now, so no second query and no id map. */
  const isVerified = (r: ProfileRow) =>
    (r.seller_badges ?? []).some(
      (b) => !b.revoked_at && new Date(b.expires_at) > new Date(),
    );
  const rows = (listRes.data ?? []) as ProfileRow[];
  const total = listRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const base = new URLSearchParams();
  if (sp.status) base.set("status", sp.status);
  if (sp.q) base.set("q", sp.q);
  if (sp.page) base.set("page", sp.page);
  const hrefBase = `/admin/vendeurs?${base.toString()}${base.toString() ? "&" : ""}`;
  const listHref = `/admin/vendeurs${base.toString() ? `?${base.toString()}` : ""}`;

  const openId = sp.a ?? null;
  const detail = openId ? await loadSeller(admin, openId) : null;

  return (
    <FullBleed>
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-4">
        <h1 className="shrink-0 text-[13px] font-semibold tracking-tight text-foreground">
          Vendeurs
        </h1>
        <Toolbar
          tabs={tabs}
          defaultTab="all"
          searchPlaceholder="Nom ou téléphone…"
          resetParams={["page", "a"]}
        />
      </header>

      <QueueKeys />

      <div className="flex min-h-0 flex-1">
        <div
          className={`flex min-h-0 w-full flex-col border-border lg:w-[360px] lg:shrink-0 lg:border-e xl:w-[400px] ${
            detail ? "hidden lg:flex" : "flex"
          }`}
        >
          {rows.length === 0 ? (
            <div className="p-5">
              <EmptyState
                Icon={Users}
                tone={q ? "filtered" : "idle"}
                title={q ? "Aucun compte ne correspond" : `Rien dans « ${TAB_LABEL[tab]} »`}
                hint={q ? "Essayez un autre nom ou numéro." : undefined}
              />
            </div>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto overscroll-contain">
              {rows.map((r) => {
                const selected = r.id === openId;
                const badge = isVerified(r);
                return (
                  <li key={r.id}>
                    <Link
                      href={`${hrefBase}a=${r.id}` as "/admin/vendeurs"}
                      data-row-id={r.id}
                      aria-current={selected ? "true" : undefined}
                      prefetch={false}
                      className={`${ROW_BASE} ${ROW_FOCUS} ${selected ? ROW_SELECTED : ROW_IDLE}`}
                    >
                      <span className="mt-[6px] shrink-0">
                        <StatusPill
                          tone={r.banned_at ? "bad" : r.role === "admin" ? "info" : "neutral"}
                          dotOnly
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`flex items-center gap-1.5 truncate text-[13px] ${
                            selected ? "font-semibold text-foreground" : "font-medium text-foreground/90"
                          }`}
                        >
                          <span className="truncate">{r.full_name ?? "Sans nom"}</span>
                          {badge && (
                            <BadgeCheck
                              className="size-3 shrink-0 text-[var(--gold)]"
                              strokeWidth={2.6}
                            />
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-subtle">
                          {[r.phone, r.governorate].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      <span className="shrink-0 text-end text-[11.5px] text-subtle">
                        {r.banned_at ? (
                          <span className="text-[var(--tone-bad)]">suspendu</span>
                        ) : (
                          TAB_LABEL.all && roleShort(r.role)
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="shrink-0 border-t border-border px-4 py-2">
              <AdminPager page={page} totalPages={totalPages} />
            </div>
          )}
        </div>

        <div className={`min-w-0 flex-1 ${detail ? "flex" : "hidden lg:flex"}`}>
          {detail ? (
            <div className="w-full">
              <SellerDetail seller={detail} backHref={listHref} />
            </div>
          ) : (
            <div className="grid w-full place-items-center px-6">
              <p className="max-w-xs text-center text-[12.5px] text-subtle">
                Choisissez un compte à gauche.
              </p>
            </div>
          )}
        </div>
      </div>
    </FullBleed>
  );
}

function roleShort(role: string): string {
  return role === "agency" ? "agence" : role === "admin" ? "admin" : "particulier";
}

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

async function loadSeller(admin: Admin, id: string): Promise<SellerDetailData | null> {
  const { data: p } = await admin
    .from("profiles")
    .select("id, full_name, phone, role, governorate, created_at, banned_at, banned_reason")
    .eq("id", id)
    .maybeSingle();
  if (!p) return null;

  const nowIso = new Date().toISOString();
  const [listingsRes, publishedRes, creditsRes, badgeRes, paymentsRes, packsRes] =
    await Promise.all([
      admin.from("listings").select("id", { count: "exact", head: true }).eq("seller_id", id),
      admin
        .from("listings")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", id)
        .eq("status", "published"),
      admin
        .from("seller_credits")
        .select("quota_total, quota_used, expires_at")
        .eq("seller_id", id)
        .eq("status", "active")
        .gt("expires_at", nowIso),
      admin
        .from("seller_badges")
        .select("expires_at")
        .eq("seller_id", id)
        .is("revoked_at", null)
        .gt("expires_at", nowIso)
        .maybeSingle(),
      admin.from("payments").select("amount").eq("user_id", id).eq("status", "captured"),
      admin
        .from("products")
        .select("id, name_fr, listing_quota")
        .eq("kind", "listing_pack")
        .eq("is_active", true)
        .order("sort_order"),
    ]);

  const credits = (creditsRes.data ?? []) as {
    quota_total: number; quota_used: number; expires_at: string;
  }[];
  const totalQuota = credits.reduce((s, c) => s + (c.quota_total ?? 0), 0);
  const usedQuota = credits.reduce((s, c) => s + (c.quota_used ?? 0), 0);
  // The soonest expiry is the one that matters: it is the next thing to lapse.
  const soonest = credits
    .map((c) => c.expires_at)
    .sort()
    .at(0) ?? null;

  const payments = (paymentsRes.data ?? []) as { amount: number | string }[];

  return {
    id: p.id as string,
    name: (p.full_name as string | null) ?? "Sans nom",
    phone: (p.phone as string | null) ?? null,
    role: p.role as string,
    governorate: (p.governorate as string | null) ?? null,
    createdAt: p.created_at as string,
    bannedAt: (p.banned_at as string | null) ?? null,
    bannedReason: (p.banned_reason as string | null) ?? null,
    listings: { published: publishedRes.count ?? 0, total: listingsRes.count ?? 0 },
    credits: { remaining: totalQuota - usedQuota, total: totalQuota, expiresAt: soonest },
    badge: badgeRes.data ? { expiresAt: badgeRes.data.expires_at as string } : null,
    payments: {
      captured: payments.length,
      amount: payments.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    },
    packs: (packsRes.data ?? []).map((r) => ({
      id: r.id as string,
      label: r.name_fr as string,
      quota: (r.listing_quota as number | null) ?? null,
    })),
  };
}
