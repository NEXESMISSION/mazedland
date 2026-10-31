/**
 * Connecting Mazed Immo's Facebook page (and the Instagram account linked to
 * it) — what the OAuth routes need, in one place.
 *
 * Needs three values in the environment, none of which ever reach the
 * browser:
 *   META_APP_ID, META_APP_SECRET   the Meta app (developers.facebook.com)
 *   SOCIAL_TOKEN_KEY               the key that seals the page token (crypto.ts)
 * Optional:
 *   META_PAGE_ID           keep only that page when the person who connects
 *                          manages several — its id or its username
 *                          (« mazedonline » for facebook.com/mazedonline)
 *   META_LOGIN_CONFIG_ID   a « Facebook Login for Business » configuration;
 *                          without it the dialog asks for the scopes itself
 *
 * The redirect URI to register in the Meta app is the address the admin uses,
 * + /api/admin/social/meta/callback — one line per address (the site, and
 * http://localhost:3001 to try it locally).
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { hasTokenKey, sealToken } from "./crypto";
import type { ManagedPage } from "./meta";
import { dueNow } from "./server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const STATE_COOKIE = "mz_meta_state";

export type MetaConfig = { appId: string; appSecret: string; pageId: string | null; loginConfigId: string | null };

export function metaConfig(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret || !hasTokenKey(env)) return null;
  return {
    appId,
    appSecret,
    pageId: env.META_PAGE_ID?.trim().replace(/^@/, "") || null,
    loginConfigId: env.META_LOGIN_CONFIG_ID?.trim() || null,
  };
}

/** What is missing before « Connecter » can work — shown in the console. */
export function missingMetaConfig(env: Record<string, string | undefined> = process.env): string[] {
  const missing: string[] = [];
  if (!env.META_APP_ID?.trim()) missing.push("META_APP_ID");
  if (!env.META_APP_SECRET?.trim()) missing.push("META_APP_SECRET");
  if (!hasTokenKey(env)) missing.push("SOCIAL_TOKEN_KEY");
  return missing;
}

/**
 * Where Facebook sends the admin back: the address they started from. The
 * one-time state cookie lives on that host, so going back anywhere else (the
 * canonical domain while they used the vercel.app one) would lose it.
 */
export function callbackUrl(requestOrigin: string): string {
  return `${requestOrigin.replace(/\/+$/, "")}/api/admin/social/meta/callback`;
}

/**
 * What the console says when « Connecter Facebook » comes back without a page:
 * the permissions Facebook granted, the Pages the person ticked, the Pages the
 * token reaches, and the one expected. Nothing secret — ids, names, scopes — so
 * the admin (and whoever helps them) can see which of the three is missing.
 */
export function connectDiagnostic(opts: {
  scopes: string[];
  pageTargets: string[];
  pages: Pick<ManagedPage, "id" | "name">[];
  wanted: string | null;
}): string {
  const list = (xs: string[]) => (xs.length ? xs.join(", ") : "—");
  return [
    `permissions : ${list(opts.scopes)}`,
    `pages cochées : ${list(opts.pageTargets)}`,
    `pages trouvées : ${list(opts.pages.map((p) => `${p.name} (${p.id})`))}`,
    `attendue : ${opts.wanted ?? "toutes"}`,
  ]
    .join(" · ")
    .slice(0, 480);
}

/** Whether a managed page is the one META_PAGE_ID names (id or username). */
export function isWantedPage(page: Pick<ManagedPage, "id" | "username">, wanted: string | null): boolean {
  if (!wanted) return true;
  const w = wanted.toLowerCase();
  return page.id === wanted || (page.username ?? "").toLowerCase() === w;
}

/**
 * Store the pages (sealed tokens) and their Instagram accounts, and put back
 * in the queue the jobs that were waiting for a connection.
 */
export async function saveConnectedPages(
  admin: Admin,
  pages: ManagedPage[],
  opts: { adminId: string; scopes: string[]; pageId: string | null },
): Promise<number> {
  const keep = pages.filter((p) => isWantedPage(p, opts.pageId));
  const now = new Date().toISOString();
  for (const page of keep) {
    const { data: fb } = await admin
      .from("social_accounts")
      .upsert(
        {
          platform: "facebook_page",
          external_id: page.id,
          name: page.name,
          token_sealed: sealToken(page.accessToken),
          token_expires_at: null,
          scopes: opts.scopes,
          status: "connected",
          last_error: null,
          last_checked_at: now,
          connected_by: opts.adminId,
          connected_at: now,
        },
        { onConflict: "platform,external_id" },
      )
      .select("id")
      .single();
    if (fb && page.instagram) {
      await admin.from("social_accounts").upsert(
        {
          platform: "instagram",
          external_id: page.instagram.id,
          name: page.name,
          username: page.instagram.username,
          parent_account_id: fb.id,
          token_sealed: null,
          token_expires_at: null,
          scopes: opts.scopes,
          status: "connected",
          last_error: null,
          last_checked_at: now,
          connected_by: opts.adminId,
          connected_at: now,
        },
        { onConflict: "platform,external_id" },
      );
    }
  }

  await requeueWaitingJobs(admin);
  return keep.length;
}

/**
 * Jobs blocked on a missing or expired connection go back to the engine —
 * after a (re)connection, and after « Tester la connexion » finds the
 * Instagram account a page has been given since (checkSocialAccount).
 */
export async function requeueWaitingJobs(admin: Admin): Promise<void> {
  const { data: accounts } = await admin
    .from("social_accounts")
    .select("id, platform")
    .eq("status", "connected")
    .order("connected_at", { ascending: false });
  for (const platform of ["facebook_page", "instagram"] as const) {
    const account = (accounts ?? []).find((a) => a.platform === platform);
    if (!account) continue;
    await admin
      .from("social_publication_jobs")
      .update({ status: "scheduled", account_id: account.id, manual_reason: null, run_after: dueNow(), attempts: 0 })
      .eq("channel", platform)
      .eq("status", "manual_action_required")
      .in("manual_reason", ["no_account", "account_expired"]);
  }
}
