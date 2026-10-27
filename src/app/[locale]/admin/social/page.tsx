import { requireAdmin } from "@/lib/admin/session";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Toolbar, type Tab } from "@/components/admin/kit/Toolbar";
import { PostPreview } from "@/components/social/PostPreview";
import { Ltr } from "@/components/ui/Ltr";
import { Link } from "@/i18n/navigation";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { formatDate, formatNumber } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import type { SocialChannel, SocialLanguage } from "@/lib/social/channels";
import { trackedUrl } from "@/lib/social/content";
import { callbackUrl, missingMetaConfig } from "@/lib/social/connect";
import { socialOrigin, socialSettings } from "@/lib/social/server";
import { AccountActions, AccountTest, GroupActions, GroupForm, JobActions, ReviewActions, VariantEditor } from "./SocialActions";

export const dynamic = "force-dynamic";

/**
 * Social Publisher (0170) — the console side of « promouvoir mon annonce ».
 *
 *   À valider   the asks waiting for a person: the posts as they will read,
 *               editable, approved now or at a set time, or refused with a reason
 *   File        what is not finished: queued, failed, and the tasks for a
 *               person (the groups, anything without a connected account)
 *   Publiés     where each annonce is online, and the visits and contacts it brought
 *   Comptes     the Facebook page and Instagram account the site posts to
 *   Groupes     the Facebook groups directory
 */
const TABS = ["valider", "file", "publies", "comptes", "groupes"] as const;
type TabKey = (typeof TABS)[number];

type ListingRef = { id: string; title: string; governorate: string; deal_type: string | null };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export default async function AdminSocialPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; connected?: string; error?: string }>;
}) {
  await requireAdmin("social");
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("adminSocial");
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const tab: TabKey = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as TabKey) : "valider";

  const head = (table: string) => admin.from(table).select("id", { count: "exact", head: true });
  const [pendingCount, openCount, publishedCount, accountsCount, groupsCount, settings] = await Promise.all([
    head("social_publication_requests").eq("status", "pending_approval"),
    head("social_publication_jobs").in("status", ["scheduled", "running", "failed", "manual_action_required"]),
    head("social_publication_requests").eq("status", "published"),
    head("social_accounts").eq("status", "connected"),
    head("social_group_directory"),
    socialSettings(admin),
  ]);
  const tabs: Tab[] = TABS.map((k) => ({
    value: k,
    label: t(`tabs.${k}`),
    count: {
      valider: pendingCount.count ?? 0,
      file: openCount.count ?? 0,
      publies: publishedCount.count ?? 0,
      comptes: accountsCount.count ?? 0,
      groupes: groupsCount.count ?? 0,
    }[k],
  }));

  const date = (v: string | null) => (v ? formatDate(v, locale, "medium") : "—");
  const channelName = (c: string) => t(`channels.${c}`);

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description", {
          price: settings.priceTnd > 0 ? t("pricePaid", { amount: settings.priceTnd }) : t("priceFree"),
          mode: t(settings.autoApprove ? "modeAuto" : "modeReview"),
        })}
      />
      <div className="mt-4 flex h-11 items-center border-b border-border">
        <Toolbar tabs={tabs} tabParam="tab" defaultTab="valider" search={false} resetParams={["page", "connected", "error"]} />
      </div>

      {tab === "valider" && <ReviewTab />}
      {tab === "file" && <QueueTab />}
      {tab === "publies" && <PublishedTab />}
      {tab === "comptes" && <AccountsTab />}
      {tab === "groupes" && <GroupsTab />}
    </div>
  );

  // ── À valider ────────────────────────────────────────────────────────────
  async function ReviewTab() {
    const { data } = await admin!
      .from("social_publication_requests")
      .select(
        `id, ref, channels, language, created_at, consent_at, price_tnd,
         listing:listings (id, title, governorate, deal_type),
         user:profiles!social_publication_requests_user_id_fkey (full_name, phone),
         variants:social_content_variants (id, channel, body, photo_paths, edited_at)`,
      )
      .eq("status", "pending_approval")
      .order("created_at", { ascending: true })
      .limit(20);
    type R = {
      id: string; ref: string; channels: SocialChannel[]; language: SocialLanguage; created_at: string; consent_at: string;
      listing: ListingRef | ListingRef[] | null;
      user: { full_name: string | null; phone: string | null } | { full_name: string | null; phone: string | null }[] | null;
      variants: { id: string; channel: SocialChannel; body: string; photo_paths: string[]; edited_at: string | null }[] | null;
    };
    const rows = (data ?? []) as unknown as R[];
    if (rows.length === 0) return <Empty text={t("emptyReview")} />;
    return (
      <div className="mt-4 space-y-4">
        {rows.map((r) => {
          const l = one(r.listing);
          const u = one(r.user);
          const variants = (r.variants ?? []).slice().sort((a, b) => r.channels.indexOf(a.channel) - r.channels.indexOf(b.channel));
          return (
            <section key={r.id} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">
                    <Ltr>MZ-{r.ref}</Ltr> · {date(r.created_at)} · {t(`languages.${r.language}`)}
                  </p>
                  {l && (
                    <Link href={`/annonces/${l.id}` as never} target="_blank" className="mt-0.5 block truncate text-[15px] font-extrabold text-foreground hover:text-[var(--gold)]" dir="auto">
                      {l.title}
                    </Link>
                  )}
                  <p className="text-[12px] text-muted">
                    {u?.full_name ?? t("noName")}
                    {u?.phone && <> · <Ltr>{u.phone}</Ltr></>}
                    {" · "}
                    {t("consentOn", { date: date(r.consent_at) })}
                  </p>
                </div>
                <ReviewActions requestId={r.id} />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                {variants.map((v) => (
                  <div key={v.id} className="space-y-2">
                    <PostPreview
                      channel={v.channel}
                      body={v.body}
                      photos={(v.photo_paths ?? []).slice(0, v.channel === "instagram" ? 10 : 4).map((p) => propertyPhotoUrl(p, { transform: { width: 480, quality: 60 } }))}
                      label={channelName(v.channel)}
                    />
                    <VariantEditor variantId={v.id} body={v.body} edited={!!v.edited_at} />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  // ── File ─────────────────────────────────────────────────────────────────
  async function QueueTab() {
    const { data } = await admin!
      .from("social_publication_jobs")
      .select(
        `id, request_id, channel, group_id, action, status, manual_reason, attempts, max_attempts, run_after, last_error, updated_at,
         group:social_group_directory (name, url, allows_links, rules, members),
         request:social_publication_requests (ref, language, listing:listings (id, title, governorate, deal_type))`,
      )
      .in("status", ["scheduled", "running", "failed", "manual_action_required"])
      .order("updated_at", { ascending: false })
      .limit(100);
    type G = { name: string; url: string; allows_links: boolean; rules: string | null; members: number | null };
    type Q = { ref: string; language: SocialLanguage; listing: ListingRef | ListingRef[] | null };
    type J = {
      id: string; request_id: string; channel: SocialChannel; group_id: string | null; action: string; status: string;
      manual_reason: string | null; attempts: number; max_attempts: number; run_after: string; last_error: string | null; updated_at: string;
      group: G | G[] | null; request: Q | Q[] | null;
    };
    const jobs = (data ?? []) as unknown as J[];
    if (jobs.length === 0) return <Empty text={t("emptyQueue")} />;

    // The groups' text, with each group's own link (or none where links are refused).
    const requestIds = [...new Set(jobs.filter((j) => j.channel === "facebook_groups").map((j) => j.request_id))];
    const { data: vrows } = requestIds.length
      ? await admin!.from("social_content_variants").select("request_id, body, link_url").eq("channel", "facebook_groups").in("request_id", requestIds)
      : { data: [] };
    const groupText = new Map(((vrows ?? []) as { request_id: string; body: string; link_url: string | null }[]).map((v) => [v.request_id, v]));
    const origin = socialOrigin();

    return (
      <ul className="mt-4 space-y-2">
        {jobs.map((j) => {
          const q = one(j.request);
          const l = one(q?.listing);
          const g = one(j.group);
          const manual = j.status === "manual_action_required";
          let copyText: string | null = null;
          if (j.channel === "facebook_groups" && j.action === "publish" && q && l) {
            const v = groupText.get(j.request_id);
            if (v) {
              const own = trackedUrl(origin, l.id, { ref: q.ref, channel: "facebook_groups", language: q.language, group: j.group_id });
              copyText = g && !g.allows_links
                ? v.body.split("\n").filter((line) => !(v.link_url && line.includes(v.link_url))).join("\n")
                : v.link_url ? v.body.split(v.link_url).join(own) : v.body;
            }
          }
          return (
            <li key={j.id} className="rounded-2xl bg-surface p-3.5 ring-1 ring-border">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-bold text-foreground">
                    {channelName(j.channel)}
                    {g && <> · <a href={g.url} target="_blank" rel="noreferrer" className="hover:text-[var(--gold)]">{g.name}</a></>}
                    {j.action !== "publish" && <span className="text-[var(--gold)]"> · {t(`actions.${j.action}`)}</span>}
                  </p>
                  {l && <p className="truncate text-[12px] text-muted" dir="auto"><Ltr>MZ-{q?.ref}</Ltr> · {l.title}</p>}
                  <p className="mt-1 text-[11.5px]">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${j.status === "failed" ? "mazed-tone-bad" : manual ? "mazed-tone-warn" : "bg-surface-2 text-muted"}`}>
                      {t(`jobStatus.${j.status}`)}
                    </span>
                    {j.manual_reason && <span className="ms-2 text-muted">{t(`manualReason.${j.manual_reason}`)}</span>}
                    {j.status === "scheduled" && <span className="ms-2 text-muted">{t("runAfter", { date: formatDate(j.run_after, locale, "dateTime") })}</span>}
                    {j.attempts > 0 && <span className="ms-2 text-muted">{t("attempts", { n: j.attempts, max: j.max_attempts })}</span>}
                  </p>
                  {g?.rules && <p className="mt-1 text-[11.5px] italic text-muted" dir="auto">{g.rules}</p>}
                  {g && !g.allows_links && <p className="mt-1 text-[11.5px] text-[var(--tone-warn)]">{t("noLinks")}</p>}
                  {j.last_error && j.status !== "manual_action_required" && (
                    <p className="mt-1 line-clamp-2 font-mono text-[11px] text-muted" dir="ltr">{j.last_error}</p>
                  )}
                </div>
                <div className="w-full sm:w-auto sm:min-w-[320px]">
                  <JobActions
                    jobId={j.id}
                    canRun={(j.channel === "facebook_page" || j.channel === "instagram") && (j.status === "scheduled" || j.status === "failed")}
                    manual={manual}
                    copyText={copyText}
                    groupUrl={g?.url ?? null}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  // ── Publiés ──────────────────────────────────────────────────────────────
  async function PublishedTab() {
    const { data } = await admin!
      .from("social_publication_requests")
      .select(
        `id, ref, status, created_at, closed_at,
         listing:listings (id, title, governorate, deal_type),
         jobs:social_publication_jobs (channel, group_id, action, status, external_url, published_at)`,
      )
      .in("status", ["published", "withdrawn", "failed"])
      .order("created_at", { ascending: false })
      .limit(50);
    type R = {
      id: string; ref: string; status: string; created_at: string; closed_at: string | null;
      listing: ListingRef | ListingRef[] | null;
      jobs: { channel: SocialChannel; group_id: string | null; action: string; status: string; external_url: string | null; published_at: string | null }[] | null;
    };
    const rows = (data ?? []) as unknown as R[];
    if (rows.length === 0) return <Empty text={t("emptyPublished")} />;

    const { data: events } = await admin!.from("social_tracking_events").select("request_id, channel, event").in("request_id", rows.map((r) => r.id));
    const tally = new Map<string, { visit: number; contact: number }>();
    for (const e of (events ?? []) as { request_id: string; event: "visit" | "contact" }[]) {
      const c = tally.get(e.request_id) ?? { visit: 0, contact: 0 };
      c[e.event] += 1;
      tally.set(e.request_id, c);
    }

    return (
      <section className="mt-4 overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
        <table className="w-full min-w-[760px] text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-[11px] text-muted">
              <th className="px-4 py-3 text-start font-semibold">{t("cols.listing")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("cols.posts")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.visits")}</th>
              <th className="px-4 py-3 text-end font-semibold">{t("cols.contacts")}</th>
              <th className="px-4 py-3 text-start font-semibold">{t("cols.status")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const l = one(r.listing);
              const posts = (r.jobs ?? []).filter((j) => j.action === "publish" && j.status === "published");
              const c = tally.get(r.id) ?? { visit: 0, contact: 0 };
              return (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground" dir="auto">{l?.title ?? "—"}</p>
                    <p className="text-[11.5px] text-muted"><Ltr>MZ-{r.ref}</Ltr> · {l ? governorateLabel(l.governorate, locale) : ""} · {date(r.created_at)}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {posts.length === 0 && <span className="text-muted">—</span>}
                      {posts.map((p, i) =>
                        p.external_url ? (
                          <a key={i} href={p.external_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-border hover:text-[var(--gold)]">
                            {channelName(p.channel)} <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          <span key={i} className="rounded-full px-2 py-0.5 text-[11.5px] text-muted ring-1 ring-border">{channelName(p.channel)}</span>
                        ),
                      )}
                    </div>
                  </td>
                  <td className="mazed-tabular px-4 py-3 text-end font-bold text-foreground">{formatNumber(c.visit, locale)}</td>
                  <td className="mazed-tabular px-4 py-3 text-end font-bold text-foreground">{formatNumber(c.contact, locale)}</td>
                  <td className="px-4 py-3 text-muted">{t(`requestStatus.${r.status}`)}{r.closed_at ? ` · ${t("closedOn", { date: date(r.closed_at) })}` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    );
  }

  // ── Comptes ──────────────────────────────────────────────────────────────
  async function AccountsTab() {
    const { data } = await admin!
      .from("social_accounts")
      .select("id, platform, name, username, status, token_expires_at, last_error, connected_at, parent_account_id")
      .order("connected_at", { ascending: false });
    const accounts = (data ?? []) as {
      id: string; platform: string; name: string; username: string | null; status: string; token_expires_at: string | null;
      last_error: string | null; connected_at: string; parent_account_id: string | null;
    }[];
    const missing = missingMetaConfig();
    // The address to register is the one the admin is using (see callbackUrl).
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
    const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127.0.0.1)(:d+)?$/.test(host) ? "http" : "https");
    const here = host ? `${proto}://${host}` : socialOrigin();
    return (
      <div className="mt-4 space-y-4">
        {sp.connected && <p className="rounded-xl mazed-tone-ok px-4 py-3 text-[12.5px] font-semibold">{t("connectedOk", { count: Number(sp.connected) || 1 })}</p>}
        {sp.error && <p className="rounded-xl mazed-tone-bad px-4 py-3 text-[12.5px] font-semibold">{t(`connectError.${["denied", "state", "not_configured", "no_page"].includes(sp.error) ? sp.error : "failed"}`)}</p>}

        <section className="rounded-2xl bg-surface p-4 ring-1 ring-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-bold text-foreground">{t("connectTitle")}</p>
              <p className="mt-0.5 max-w-xl text-[12px] leading-relaxed text-muted">{t("connectBody")}</p>
            </div>
            {missing.length === 0 ? (
              // A full navigation to an API route that redirects to Facebook,
              // not a page: <Link> would try to render it client-side.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a href="/api/admin/social/meta/connect" className="inline-flex h-8 items-center rounded bg-[var(--gold)] px-3 text-[12.5px] font-semibold text-[var(--background)] hover:bg-[var(--gold-bright)]">
                {t(accounts.some((a) => a.platform === "facebook_page") ? "reconnect" : "connect")}
              </a>
            ) : (
              <span className="text-[12px] font-semibold text-[var(--tone-warn)]">{t("notConfigured")}</span>
            )}
          </div>
          {missing.length > 0 && (
            <div className="mt-3 rounded-xl bg-surface-2 p-3 text-[12px] leading-relaxed text-foreground ring-1 ring-border">
              <p className="font-semibold">{t("setupTitle")}</p>
              <ol className="mt-1 list-decimal space-y-0.5 ps-5 text-muted">
                <li>{t("setup1")}</li>
                <li>{t("setup2")}</li>
                <li>
                  {t("setup3")} <Ltr className="font-mono break-all text-foreground">{callbackUrl(here)}</Ltr>
                </li>
                <li>
                  {t("setup4")} <Ltr className="font-mono break-all text-foreground">{missing.join(", ")}</Ltr>
                </li>
              </ol>
            </div>
          )}
        </section>

        {accounts.length === 0 ? (
          <Empty text={t("emptyAccounts")} />
        ) : (
          <ul className="space-y-2">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-3.5 ring-1 ring-border">
                <div>
                  <p className="text-[13px] font-bold text-foreground">
                    {channelName(a.platform)} · {a.name}
                    {a.username && <span className="text-muted"> · @{a.username}</span>}
                  </p>
                  <p className="text-[11.5px] text-muted">
                    <span className={`me-2 rounded-full px-2 py-0.5 font-bold ${a.status === "connected" ? "mazed-tone-ok" : "mazed-tone-bad"}`}>
                      {t(`accountStatus.${a.status}`)}
                    </span>
                    {t("connectedOn", { date: date(a.connected_at) })}
                    {a.token_expires_at ? ` · ${t("expiresOn", { date: date(a.token_expires_at) })}` : a.status === "connected" ? ` · ${t("noExpiry")}` : ""}
                  </p>
                  {a.last_error && <p className="mt-1 font-mono text-[11px] text-muted" dir="ltr">{a.last_error}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.status === "connected" && <AccountTest accountId={a.id} />}
                  {a.status === "connected" && !a.parent_account_id && <AccountActions accountId={a.id} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Groupes ──────────────────────────────────────────────────────────────
  async function GroupsTab() {
    const { data } = await admin!.from("social_group_directory").select("*").order("created_at", { ascending: false });
    const groups = (data ?? []) as {
      id: string; name: string; url: string; governorates: string[]; deal_types: string[]; category_kinds: string[];
      members: number | null; allows_links: boolean; rules: string | null; status: string; last_shared_at: string | null;
    }[];
    return (
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          {groups.length === 0 ? (
            <Empty text={t("emptyGroups")} />
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <li key={g.id} className={`rounded-2xl bg-surface p-3.5 ring-1 ring-border ${g.status === "paused" ? "opacity-60" : ""}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={g.url} target="_blank" rel="noreferrer" className="text-[13px] font-bold text-foreground hover:text-[var(--gold)]" dir="auto">
                        {g.name}
                      </a>
                      <p className="text-[11.5px] text-muted">
                        {g.deal_types.map((d) => t(`deal.${d}`)).join(" · ")}
                        {" · "}
                        {g.governorates.length ? g.governorates.map((x) => governorateLabel(x, locale)).join(", ") : t("allTunisia")}
                        {g.category_kinds.length > 0 && ` · ${g.category_kinds.map((k) => t(`kind.${k}`)).join(", ")}`}
                        {g.members != null && ` · ${t("members", { count: formatNumber(g.members, locale) })}`}
                      </p>
                      <p className="text-[11.5px] text-muted">
                        {g.allows_links ? t("linksOk") : t("noLinks")}
                        {" · "}
                        {g.last_shared_at ? t("lastShared", { date: date(g.last_shared_at) }) : t("neverShared")}
                      </p>
                      {g.rules && <p className="mt-0.5 text-[11.5px] italic text-muted" dir="auto">{g.rules}</p>}
                    </div>
                    <GroupActions groupId={g.id} status={g.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <GroupForm />
      </div>
    );
  }
}

function Empty({ text }: { text: string }) {
  return <p className="mt-6 rounded-2xl border border-dashed border-border p-8 text-center text-[13px] text-muted">{text}</p>;
}
