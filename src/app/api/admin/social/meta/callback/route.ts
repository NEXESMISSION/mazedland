import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getAdminSession } from "@/lib/admin/session";
import { canOpen } from "@/lib/admin/sections";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { log } from "@/lib/log";
import { callbackUrl, metaConfig, saveConnectedPages, STATE_COOKIE } from "@/lib/social/connect";
import { graphClient, inspectToken, managedPages, userTokenFromCode } from "@/lib/social/meta";

export const dynamic = "force-dynamic";

const sLog = log.scope("social");

/**
 * GET /api/admin/social/meta/callback?code=…&state=… — Facebook sends the
 * admin back here. The code becomes a long-lived user token, which gives a
 * page token that does not expire; that one is sealed and stored, the user
 * token is not kept. Back to the console's accounts tab either way.
 */
export async function GET(req: NextRequest) {
  const cookie = req.cookies.get(STATE_COOKIE)?.value ?? "";
  const [expected, cookieLocale] = cookie.split(".");
  const locale = cookieLocale === "ar" ? "ar" : "fr";
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/${locale}/admin/social?tab=comptes&${q}`, req.nextUrl.origin));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/admin/social/meta" });
    return res;
  };

  const { user, isAdmin, scopes } = await getAdminSession();
  if (!user || !isAdmin || !canOpen(scopes, "social")) return NextResponse.redirect(new URL(`/${locale}/login`, req.nextUrl.origin));

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("error=denied");
  const state = sp.get("state") ?? "";
  const code = sp.get("code") ?? "";
  const same =
    !!expected && state.length === expected.length && timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!same || !code) return back("error=state");

  const config = metaConfig();
  const admin = getServiceSupabase();
  if (!config || !admin) return back("error=not_configured");

  try {
    const { token } = await userTokenFromCode({
      appId: config.appId,
      appSecret: config.appSecret,
      redirectUri: callbackUrl(req.nextUrl.origin),
      code,
    });
    const info = await inspectToken({ appId: config.appId, appSecret: config.appSecret, token });
    const pages = await managedPages(graphClient(token, { appSecret: config.appSecret }));
    if (pages.length === 0) return back("error=no_page");
    const saved = await saveConnectedPages(admin, pages, { adminId: user.id, scopes: info.scopes, pageId: config.pageId });
    if (saved === 0) return back("error=no_page");
    logAction(req, user, "social.account_connect", { pages: saved });
    return back(`connected=${saved}`);
  } catch (err) {
    sLog.warn("meta connect failed", { msg: err instanceof Error ? err.message : String(err) });
    return back("error=failed");
  }
}
