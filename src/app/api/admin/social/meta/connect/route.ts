import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { getAdminSession } from "@/lib/admin/session";
import { requestLocale } from "@/lib/i18n/server";
import { callbackUrl, metaConfig, STATE_COOKIE } from "@/lib/social/connect";
import { oauthDialogUrl } from "@/lib/social/meta";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/social/meta/connect — send an admin to Facebook to connect
 * Mazed Immo's page. A link the admin clicks, so it is a plain navigation; the
 * one-time `state` in a cookie is what ties the answer to this click.
 */
export async function GET(req: NextRequest) {
  const locale = requestLocale(req);
  const { user, isAdmin } = await getAdminSession();
  if (!user || !isAdmin) return NextResponse.redirect(new URL(`/${locale}/login`, req.nextUrl.origin));

  const config = metaConfig();
  if (!config) {
    return NextResponse.redirect(new URL(`/${locale}/admin/social?tab=comptes&error=not_configured`, req.nextUrl.origin));
  }
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(
    oauthDialogUrl({ appId: config.appId, redirectUri: callbackUrl(req.nextUrl.origin), state, configId: config.loginConfigId }),
  );
  res.cookies.set(STATE_COOKIE, `${state}.${locale}`, {
    httpOnly: true,
    secure: req.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/api/admin/social/meta",
    maxAge: 600,
  });
  return res;
}
