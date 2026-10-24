/**
 * Connecting Mazed Immo's Facebook page (and the Instagram account linked to
 * it) — what the OAuth routes need, in one place.
 *
 * Needs three values in the environment, none of which ever reach the
 * browser:
 *   META_APP_ID, META_APP_SECRET   the Meta app (developers.facebook.com)
 *   SOCIAL_TOKEN_KEY               the key that seals the page token (crypto.ts)
 * Optional: META_PAGE_ID, to keep only that page when the person who connects
 * manages several.
 *
 * The redirect URI to register in the Meta app is
 *   <site>/api/admin/social/meta/callback
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { hasTokenKey, sealToken } from "./crypto";
import { siteUrl } from "@/lib/siteUrl";
import type { ManagedPage } from "./meta";
import { dueNow } from "./server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

export const STATE_COOKIE = "mz_meta_state";

export type MetaConfig = { appId: string; appSecret: string; pageId: string | null };

export function metaConfig(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim();
  const appSecret = env.META_APP_SECRET?.trim();
  if (!appId || !appSecret || !hasTokenKey(env)) return null;
  return { appId, appSecret, pageId: env.META_PAGE_ID?.trim() || null };
}

/** What is missing before « Connecter » can work — shown in the console. */
export function missingMetaConfig(env: Record<string, string | undefined> = process.env): string[] {
  const missing: string[] = [];
  if (!env.META_APP_ID?.trim()) missing.push("META_APP_ID");
  if (!env.META_APP_SECRET?.trim()) missing.push("META_APP_SECRET");
  if (!hasTokenKey(env)) missing.push("SOCIAL_TOKEN_KEY");
  return missing;
}

export function callbackUrl(requestOrigin: string): string {
  return `${siteUrl() ?? requestOrigin}/api/admin/social/meta/callback`;
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
  const keep = opts.pageId ? pages.filter((p) => p.id === opts.pageId) : pages;
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

  // Jobs blocked on a missing or expired connection go back to the engine.
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
  return keep.length;
}
