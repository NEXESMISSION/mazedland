import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatDate, formatNumber, formatTND } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import { asDealType } from "@/lib/listings/deal";
import { activePlan, can, membershipsOf, type ShopRole } from "@/lib/pro/shops";
import { planUsage } from "@/lib/places/server";
import { PLACE_STATUSES } from "@/lib/places/model";
import { ShopForm } from "@/components/pro/ShopForm";
import { AddMember, ChoosePlan, RemoveMember, SendDocument } from "./ProActions";
import { ProClients, type ClientRow } from "./ProClients";
import { SuggestListing } from "./SuggestListing";
import { ProjectsTab } from "./ProjectsTab";
import { MAX_SUGGESTIONS_PER_REQUEST, rankForRequest } from "@/lib/pro/suggest";
import { toMatchable } from "@/lib/requests/server";
import { categoryLabel } from "@/lib/i18n";
import { VisitCard } from "@/components/visits/VisitCard";
import { loadVisits } from "@/lib/visits-server";
import { tunisDay, type LeadStage } from "@/lib/visits";
import { getSettings } from "@/lib/settings/server";
import { paymentsAreOpen } from "@/lib/payments/server";
import { PaymentsClosedNotice } from "@/components/payments/PaymentsClosedNotice";
import { BadgeCheck, ExternalLink, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const TABS = ["apercu", "annonces", "projets", "visites", "clients", "demandes", "equipe", "abonnement", "agence", "documents"] as const;
type TabKey = (typeof TABS)[number];

const STATUS_TONE: Record<string, string> = {
  pending: "mazed-tone-warn",
  approved: "mazed-tone-ok",
  rejected: "mazed-tone-bad",
  suspended: "mazed-tone-bad",
};

/**
 * Espace Pro (0173): one shop at a time (?shop=), in six tabs — where it
 * stands, its annonces, its team, its plan, its page and its papers. What a
 * member sees and may do follows their role (owner, admin, agent).
 */
export default async function ProDashboardPage({ searchParams }: { searchParams: Promise<{ shop?: string; tab?: string; p?: string }> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("pro.dashboard");
  const tKinds = await getTranslations("pro.kinds");
  const tRoles = await getTranslations("pro.roles");
  const tStatus = await getTranslations("pro.status");
  const tDocs = await getTranslations("pro.documents");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/pro/dashboard`)}`);
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const memberships = await membershipsOf(admin, user!.id);
  if (memberships.length === 0) redirect(`/${locale}/pro`);
  const current = memberships.find((m) => m.shop.id === sp.shop) ?? memberships[0];
  const { shop, role } = current;
  // « boutique » was the tab's name before the shops became agences.
  const asked = sp.tab === "boutique" ? "agence" : sp.tab;
  const tab: TabKey = (TABS as readonly string[]).includes(asked ?? "") ? (asked as TabKey) : "apercu";
  // With demandes switched off in the console, there are none to answer.
  const settings = await getSettings();
  const demandesOn = settings.feature_requests;
  const projectsOn = settings.feature_projects;
  // Everyone sees the plan; only those who may act on the page or the papers see those tabs.
  const visibleTabs = TABS.filter((k) =>
    k === "projets" ? projectsOn && can(role, "projects") : k === "agence" ? can(role, "edit_shop") : k === "documents" ? can(role, "documents") : k === "demandes" ? demandesOn && can(role, "clients") : k === "visites" || k === "clients" ? can(role, "clients") : true,
  );
  const href = (k: TabKey) => `/pro/dashboard?shop=${shop.id}&tab=${k}`;

  const [plan, used, { data: listingRows }, { count: visitsWaiting }] = await Promise.all([
    activePlan(admin, shop.id),
    // The agence's annonces and its owner's own: the plan's places (src/lib/places).
    planUsage(admin, shop.id),
    admin
      .from("listings")
      .select("id, seller_id, title, status, price, price_on_request, deal_type, view_count, contact_reveal_count, expires_at")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin.from("visit_requests").select("id", { count: "exact", head: true }).eq("shop_id", shop.id).eq("status", "requested"),
  ]);
  const listings = (listingRows ?? []) as {
    id: string; seller_id: string; title: string; status: string; price: number | null; price_on_request: boolean; deal_type: string | null;
    view_count: number; contact_reveal_count: number; expires_at: string | null;
  }[];
  const views = listings.reduce((n, l) => n + (l.view_count ?? 0), 0);
  const reveals = listings.reduce((n, l) => n + (l.contact_reveal_count ?? 0), 0);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 lg:py-10">
      {memberships.length > 1 && (
        <nav className="mb-4 flex flex-wrap gap-1.5">
          {memberships.map((m) => (
            <Link
              key={m.shop.id}
              href={`/pro/dashboard?shop=${m.shop.id}` as never}
              className={`rounded-full px-3 py-1 text-[12px] font-bold ring-1 ${m.shop.id === shop.id ? "bg-gold-faint text-foreground ring-gold-soft" : "text-muted ring-border"}`}
            >
              {m.shop.name}
            </Link>
          ))}
        </nav>
      )}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-gold">{t("eyebrow")}</p>
          <h1 className="mt-0.5 flex items-center gap-2 truncate text-[24px] font-extrabold tracking-tight" dir="auto">
            {shop.name}
            {shop.verified_at && <BadgeCheck className="size-5 shrink-0 text-gold" aria-label={t("verified")} />}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-muted">
            {tKinds(shop.kind)} · {governorateLabel(shop.governorate, locale)} · {t("yourRole", { role: tRoles(role) })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STATUS_TONE[shop.status] ?? ""}`}>{tStatus(shop.status)}</span>
          {shop.status === "approved" && (
            <Link href={`/agences/${shop.slug}` as never} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-gold hover:underline">
              {t("publicPage")} <ExternalLink className="size-3.5" />
            </Link>
          )}
        </div>
      </header>

      {shop.status !== "approved" && (
        <p className={`mt-4 rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed ${shop.status === "pending" ? "mazed-tone-warn" : "mazed-tone-bad"}`}>
          {tStatus(`hint.${shop.status}`)}
          {shop.rejection_reason && <span className="mt-1 block font-semibold" dir="auto">{shop.rejection_reason}</span>}
        </p>
      )}

      <nav className="-mx-4 mt-5 overflow-x-auto px-4 [scrollbar-width:none]">
        <div className="flex min-w-max gap-1.5">
          {visibleTabs.map((k) => (
            <Link
              key={k}
              href={href(k) as never}
              aria-current={k === tab ? "page" : undefined}
              className={`tap-target rounded-xl border px-3.5 py-2 text-[13px] font-bold transition ${
                k === tab ? "border-gold-soft bg-gold-faint text-foreground" : "border-border text-muted hover:text-foreground"
              }`}
            >
              {t(`tabs.${k}`)}
              {k === "visites" && (visitsWaiting ?? 0) > 0 && <span className="mazed-tabular ms-1 text-[11px] text-[var(--tone-warn)]">{visitsWaiting}</span>}
            </Link>
          ))}
        </div>
      </nav>

      {tab === "apercu" && (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t("planLabel")} value={plan ? plan.name : t("noPlan")} sub={plan ? t("until", { date: formatDate(plan.endsAt, locale, "medium") }) : undefined} />
          <Stat label={t("quotaLabel")} value={plan ? `${used} / ${plan.quota}` : String(used)} sub={t("quotaSub")} />
          <Stat label={t("viewsLabel")} value={formatNumber(views, locale)} />
          <Stat label={t("revealsLabel")} value={formatNumber(reveals, locale)} />
          <div className="rounded-2xl border border-border bg-surface p-4 sm:col-span-2 lg:col-span-4">
            <p className="text-[13.5px] font-extrabold text-foreground">{t("nextTitle")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {shop.status === "approved" && can(role, "publish") && (
                <Link href={`/annonces/nouvelle?shop=${shop.id}` as never} className="mazed-btn-luxe tap-target inline-flex h-10 items-center gap-1.5 px-4 text-[13px]">
                  <Plus className="size-4" /> {t("publishForShop")}
                </Link>
              )}
              {!plan && can(role, "subscribe") && shop.status === "approved" && (
                <Link href={href("abonnement") as never} className="tap-target inline-flex h-10 items-center rounded-xl border border-border px-4 text-[13px] font-bold">
                  {t("choosePlan")}
                </Link>
              )}
              {(visitsWaiting ?? 0) > 0 && (
                <Link href={href("visites") as never} className="tap-target inline-flex h-10 items-center rounded-xl border border-border px-4 text-[13px] font-bold">
                  {t("visitsWaiting", { count: visitsWaiting ?? 0 })}
                </Link>
              )}
              {can(role, "documents") && !shop.verified_at && (
                <Link href={href("documents") as never} className="tap-target inline-flex h-10 items-center rounded-xl border border-border px-4 text-[13px] font-bold">
                  {t("getVerified")}
                </Link>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === "annonces" && (
        <section className="mt-5">
          {listings.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted">{t("noListings")}</p>
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
              {listings.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-bold text-foreground" dir="auto">{l.title}</p>
                    <p className="text-[11.5px] text-muted">
                      {t(`listingStatus.${l.status}`)} ·{" "}
                      {l.price_on_request || l.price == null
                        ? t("onRequest")
                        : `${formatTND(Number(l.price), locale)} ${asDealType(l.deal_type) === "rent" ? t("perMonth") : t("tnd")}`}{" "}
                      · {t("viewsShort", { count: l.view_count ?? 0 })}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-[12.5px] font-bold">
                    {/* The edit form is its author's (0172). */}
                    {settings.feature_listing_edit && l.status === "published" && l.seller_id === user!.id && <Link href={`/annonces/nouvelle?edit=${l.id}` as never} className="text-foreground hover:underline">{t("edit")}</Link>}
                    {l.status === "published" && <Link href={`/annonces/${l.id}` as never} className="text-gold hover:underline">{t("view")}</Link>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "projets" && projectsOn && can(role, "projects") && (
        <ProjectsTab shopId={shop.id} shopSlug={shop.slug} shopGovernorate={shop.governorate} projectId={sp.p} hasPlan={!!plan} />
      )}

      {tab === "visites" && can(role, "clients") && <VisitsTab shopId={shop.id} />}

      {tab === "clients" && can(role, "clients") && <ClientsTab shopId={shop.id} />}

      {tab === "demandes" && demandesOn && can(role, "clients") && <DemandesTab shopId={shop.id} shopGovernorate={shop.governorate} approved={shop.status === "approved"} />}

      {tab === "equipe" && <TeamTab shopId={shop.id} role={role} />}

      {tab === "abonnement" && <PlanTab shopId={shop.id} role={role} approved={shop.status === "approved"} current={plan} />}

      {tab === "agence" && can(role, "edit_shop") && (
        <section className="mt-5">
          <ShopForm
            mode="edit"
            initial={{
              id: shop.id,
              slug: shop.slug,
              name: shop.name,
              kind: shop.kind,
              description: shop.description ?? "",
              governorate: shop.governorate,
              city: shop.city ?? "",
              phone: shop.phone ?? "",
              email: shop.email ?? "",
              website: shop.website ?? "",
              hours: shop.hours ?? "",
              legal_name: shop.legal_name ?? "",
              legal_id: shop.legal_id ?? "",
              logo_path: shop.logo_path,
              cover_path: shop.cover_path,
            }}
          />
        </section>
      )}

      {tab === "documents" && can(role, "documents") && <DocumentsTab shopId={shop.id} verified={!!shop.verified_at} />}
    </main>
  );

  // ── Tabs that read more ────────────────────────────────────────────────────
  async function VisitsTab({ shopId }: { shopId: string }) {
    const visits = await loadVisits(admin!, { shop: shopId });
    return visits.length === 0 ? (
      <p className="mt-5 rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted">{t("noVisits")}</p>
    ) : (
      <section className="mt-5 space-y-3">
        {visits.map((v) => (
          <VisitCard key={v.id} visit={v} side="seller" locale={locale} />
        ))}
      </section>
    );
  }

  /**
   * What buyers and tenants are looking for, without who they are: the open
   * demandes that asked for alerts, near the shop or answered by one of its
   * annonces, those it can answer fully first.
   */
  async function DemandesTab({ shopId, shopGovernorate, approved }: { shopId: string; shopGovernorate: string; approved: boolean }) {
    const tReq = await getTranslations("requests");
    const tc = await getTranslations("common");
    const [{ data: reqRows }, { data: own }, { data: catRows }] = await Promise.all([
      admin!
        .from("property_requests")
        .select("id, deal_type, category_ids, governorates, budget_min, budget_max, surface_min, rooms_min, furnished, move_in_by, created_at")
        .eq("status", "active")
        .eq("alerts", true)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(300),
      admin!
        .from("listings")
        .select("id, title, deal_type, category_id, governorate, price, price_on_request, attributes, furnished, available_from")
        .eq("shop_id", shopId)
        .eq("status", "published")
        .limit(200),
      admin!.from("categories").select("id, label_fr, label_ar"),
    ]);
    type Req = { id: string; deal_type: string; category_ids: string[] | null; governorates: string[] | null; budget_min: number | string | null; budget_max: number | string | null; surface_min: number | string | null; rooms_min: number | null; furnished: string | null; move_in_by: string | null; created_at: string };
    type Lst = { id: string; title: string; deal_type: string | null; category_id: string; governorate: string; price: number | null; price_on_request: boolean; attributes: Record<string, unknown> | null; furnished: string | null; available_from: string | null };
    const requests = (reqRows ?? []) as Req[];
    const listings = ((own ?? []) as Lst[]).map((l) => ({ ...l, price: l.price == null ? null : Number(l.price) }));
    const cats = new Map(((catRows ?? []) as { id: string; label_fr: string; label_ar: string | null }[]).map((c) => [c.id, c]));
    const shopPlaces = new Set([shopGovernorate, ...listings.map((l) => l.governorate)]);

    const { data: matchRows } = requests.length && listings.length
      ? await admin!.from("matches").select("request_id, listing_id").in("request_id", requests.map((r) => r.id)).in("listing_id", listings.map((l) => l.id))
      : { data: [] };
    const offered = new Map<string, string[]>();
    for (const m of (matchRows ?? []) as { request_id: string; listing_id: string }[]) {
      offered.set(m.request_id, [...(offered.get(m.request_id) ?? []), m.listing_id]);
    }

    const money = (v: number | string) => `${formatTND(Number(v), locale)} ${tc("tnd")}`;
    const cards = requests
      .map((r) => {
        const ranked = rankForRequest(listings, toMatchable(r));
        const near = !(r.governorates ?? []).length || (r.governorates ?? []).some((g) => shopPlaces.has(g));
        return { r, ranked, full: ranked.some((x) => x.match.ok), near };
      })
      .filter((c) => c.full || c.near)
      .sort((a, b) => Number(b.full) - Number(a.full))
      .slice(0, 60);

    if (cards.length === 0) {
      return <p className="mt-5 rounded-2xl border border-dashed border-border p-8 text-center text-[13px] leading-relaxed text-muted">{t("noDemandes")}</p>;
    }
    return (
      <section className="mt-5 space-y-3">
        <p className="text-[12px] leading-relaxed text-muted">{t("demandesHint")}</p>
        {!approved && <p className="text-[12px] text-muted">{t("planAfterApproval")}</p>}
        {cards.map(({ r, ranked, full }) => {
          const rent = r.deal_type === "rent";
          const what = (r.category_ids ?? []).length
            ? (r.category_ids ?? []).map((id) => (cats.get(id) ? categoryLabel(cats.get(id)!, locale) : null)).filter(Boolean).join(", ")
            : tReq("anyCategory");
          const where = (r.governorates ?? []).length ? (r.governorates ?? []).map((g) => governorateLabel(g, locale)).join(", ") : tReq("anywhere");
          const extra = [
            r.budget_max != null ? tReq(rent ? "upToPerMonth" : "upTo", { amount: money(r.budget_max) }) : null,
            r.budget_min != null ? tReq("fromAmount", { amount: money(r.budget_min) }) : null,
            r.surface_min != null ? tReq("surfaceAtLeast", { area: formatNumber(Number(r.surface_min), locale) }) : null,
            r.rooms_min != null ? tReq("roomsAtLeast", { count: r.rooms_min }) : null,
            rent && r.furnished ? tReq(`furnished.${r.furnished}`) : null,
            rent && r.move_in_by ? tReq("moveInShort", { date: formatDate(r.move_in_by, locale, "medium") }) : null,
          ].filter(Boolean);
          const done = offered.get(r.id) ?? [];
          const options = ranked
            .filter((x) => !done.includes(x.listing.id))
            .map((x) => ({ id: x.listing.id, title: x.listing.title, score: x.match.score, ok: x.match.ok }));
          return (
            <article key={r.id} className={`rounded-2xl bg-surface p-4 ring-1 ${full ? "ring-gold-soft" : "ring-border"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-gold">{tReq(rent ? "kindRent" : "kindBuy")}</p>
                  <p className="mt-0.5 text-[14px] font-bold text-foreground">{what} · {where}</p>
                  {extra.length > 0 && <p className="mt-0.5 text-[12.5px] text-muted">{extra.join(" · ")}</p>}
                </div>
                <span className="shrink-0 text-[11px] text-muted">{formatDate(r.created_at, locale, "dayMonth")}</span>
              </div>
              {done.length > 0 && (
                <p className="mt-2 text-[12px] text-muted">
                  {t("alreadyOffered", { titles: done.map((id) => listings.find((l) => l.id === id)?.title ?? "").filter(Boolean).join(", ") })}
                </p>
              )}
              {approved && (
                <div className="mt-3">
                  <SuggestListing shopId={shopId} requestId={r.id} options={options} left={MAX_SUGGESTIONS_PER_REQUEST - done.length} />
                </div>
              )}
            </article>
          );
        })}
      </section>
    );
  }

  async function ClientsTab({ shopId }: { shopId: string }) {
    const [{ data: leadRows }, { data: own }] = await Promise.all([
      admin!
        .from("leads")
        .select("id, name, phone, stage, source, note, next_action_at, updated_at, listing:listings!leads_listing_id_fkey (id, title)")
        .eq("shop_id", shopId)
        .order("updated_at", { ascending: false })
        .limit(300),
      admin!.from("listings").select("id, title").eq("shop_id", shopId).in("status", [...PLACE_STATUSES]).order("created_at", { ascending: false }).limit(200),
    ]);
    type Raw = Omit<ClientRow, "listing" | "updated_label"> & { updated_at: string; listing: { id: string; title: string } | { id: string; title: string }[] | null };
    const clients: ClientRow[] = ((leadRows ?? []) as unknown as Raw[]).map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      stage: r.stage as LeadStage,
      source: r.source,
      note: r.note,
      next_action_at: r.next_action_at,
      listing: Array.isArray(r.listing) ? r.listing[0] ?? null : r.listing,
      updated_label: t("clientUpdated", { date: formatDate(r.updated_at, locale, "dayMonth") }),
    }));
    return <ProClients shopId={shopId} clients={clients} listings={(own ?? []) as { id: string; title: string }[]} today={tunisDay()} />;
  }

  async function TeamTab({ shopId, role: actor }: { shopId: string; role: ShopRole }) {
    const { data } = await admin!
      .from("shop_members")
      .select("user_id, role, created_at, person:profiles!shop_members_user_id_fkey (full_name, phone)")
      .eq("shop_id", shopId)
      .order("created_at");
    const members = (data ?? []) as unknown as {
      user_id: string; role: ShopRole; created_at: string;
      person: { full_name: string | null; phone: string | null } | { full_name: string | null; phone: string | null }[] | null;
    }[];
    return (
      <section className="mt-5 space-y-4">
        <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {members.map((m) => {
            const p = Array.isArray(m.person) ? m.person[0] : m.person;
            const removable = can(actor, "manage_members") && m.role !== "owner" && (actor === "owner" || m.role === "agent") && m.user_id !== user!.id;
            return (
              <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="text-[13.5px] font-bold text-foreground">{p?.full_name ?? t("noName")}</p>
                  <p className="text-[11.5px] text-muted">{tRoles(m.role)}</p>
                </div>
                {removable && <RemoveMember shopId={shopId} userId={m.user_id} />}
              </li>
            );
          })}
        </ul>
        {can(actor, "manage_members") && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <AddMember shopId={shopId} actor={actor} />
          </div>
        )}
      </section>
    );
  }

  async function PlanTab({ shopId, role: actor, approved, current: running }: { shopId: string; role: ShopRole; approved: boolean; current: Awaited<ReturnType<typeof activePlan>> }) {
    const [{ data: planRows }, { data: periods }, open] = await Promise.all([
      admin!.from("products").select("slug, name_fr, name_ar, price, listing_quota").eq("kind", "subscription").eq("is_active", true).order("price"),
      admin!.from("shop_subscriptions").select("starts_at, ends_at, listing_quota, product:products (name_fr)").eq("shop_id", shopId).order("starts_at", { ascending: false }).limit(12),
      paymentsAreOpen(),
    ]);
    const plans = (planRows ?? []) as { slug: string; name_fr: string; name_ar: string | null; price: number | string; listing_quota: number }[];
    // With no payee to pay, « Choisir » created a payment and only the checkout
    // then said « indisponible ». The tab says it first, in place of the buttons.
    const mayBuy = can(actor, "subscribe") && approved;
    return (
      <section className="mt-5 space-y-5">
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-[12.5px] leading-relaxed text-foreground ring-1 ring-border">
          {running ? t("planRunning", { name: running.name, date: formatDate(running.endsAt, locale, "medium") }) : t("planNone")}
        </p>
        {mayBuy && !open && (
          <PaymentsClosedNotice title={t("closed.title")} body={t("closed.body")} contactLabel={t("closed.contact")} />
        )}
        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.slug} className="rounded-2xl border border-border bg-surface p-4">
              <p className="text-[14px] font-extrabold text-foreground">{locale === "ar" && p.name_ar ? p.name_ar : p.name_fr}</p>
              <p className="mt-1 text-[22px] font-extrabold text-foreground">
                {formatTND(Number(p.price), locale)} <span className="text-[12px] font-normal text-muted">{t("perMonthTnd")}</span>
              </p>
              <p className="text-[12.5px] font-bold text-gold">{t("planQuota", { count: p.listing_quota })}</p>
              {mayBuy &&
                (open ? (
                  // A bigger plan starts as soon as it is paid; the same or a
                  // smaller one follows the period running (periodStart).
                  <ChoosePlan
                    shopId={shopId}
                    plan={p.slug}
                    label={!running ? t("choose") : p.listing_quota > running.quota ? t("upgradeNow") : t("renewWith")}
                  />
                ) : (
                  <p className="mt-3 text-[12px] font-semibold text-muted">{t("closed.row")}</p>
                ))}
            </div>
          ))}
        </div>
        {!approved && <p className="text-[12px] text-muted">{t("planAfterApproval")}</p>}
        <p className="text-[11.5px] leading-snug text-muted">{t("planHow")}</p>
        {(periods ?? []).length > 0 && (
          <div>
            <p className="text-[13px] font-extrabold text-foreground">{t("history")}</p>
            <ul className="mt-2 space-y-1 text-[12.5px] text-muted">
              {(periods ?? []).map((p, i) => {
                const product = (Array.isArray(p.product) ? p.product[0] : p.product) as { name_fr: string } | null;
                return (
                  <li key={i}>
                    {product?.name_fr} · {formatDate(p.starts_at as string, locale, "medium")} → {formatDate(p.ends_at as string, locale, "medium")} · {t("planQuota", { count: p.listing_quota as number })}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    );
  }

  async function DocumentsTab({ shopId, verified }: { shopId: string; verified: boolean }) {
    const { data } = await admin!.from("shop_documents").select("id, kind, file_name, created_at").eq("shop_id", shopId).order("created_at", { ascending: false });
    const docs = (data ?? []) as { id: string; kind: string; file_name: string | null; created_at: string }[];
    return (
      <section className="mt-5 space-y-4">
        <p className={`rounded-2xl px-4 py-3 text-[12.5px] leading-relaxed ${verified ? "mazed-tone-ok" : "bg-surface-2 text-foreground ring-1 ring-border"}`}>
          {verified ? t("verifiedYes") : t("verifiedHow")}
        </p>
        <SendDocument shopId={shopId} />
        {docs.length > 0 && (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[12.5px]">
                <span className="font-bold text-foreground">{tDocs(d.kind)}</span>
                <span className="truncate text-muted" dir="auto">{d.file_name ?? "—"} · {formatDate(d.created_at, locale, "medium")}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11.5px] text-muted">{t("documentsPrivate")}</p>
      </section>
    );
  }
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-[11.5px] font-bold text-muted">{label}</p>
      <p className="mazed-tabular mt-1 truncate text-[20px] font-extrabold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-muted">{sub}</p>}
    </div>
  );
}

