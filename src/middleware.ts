import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { log } from "./lib/log";

const intlMiddleware = createIntlMiddleware(routing);

// Legacy locale prefixes we used to support. Now redirected to /fr to
// preserve bookmarks, share links, and any indexed URLs.
const LEGACY_LOCALES = ["ar", "en"] as const;

/**
 * Two-stage middleware:
 *
 *   1. next-intl handles locale routing (prefix enforcement, locale
 *      cookie, etc.) and produces the base response. It may rewrite or
 *      redirect — we capture that response so we can attach Supabase
 *      cookie updates on top.
 *
 *   2. We open a server-side Supabase client bound to the incoming
 *      request and merging cookie updates into the next-intl response.
 *      Calling `supabase.auth.getUser()` refreshes the auth token if it
 *      is close to expiry; without this, the session can silently lapse
 *      and the user sees the signed-out shell after the next reload —
 *      the symptom we saw after login.
 *
 * Supabase env not configured? Return the next-intl response unchanged
 * (dev clones without `.env.local` keep working).
 */
const mwLog = log.scope("mw");

export async function middleware(req: NextRequest) {
  const t0 = performance.now();
  const { pathname, search } = req.nextUrl;

  // Legacy /ar/* and /en/* → /fr/* (preserve querystring + hash).
  for (const legacy of LEGACY_LOCALES) {
    if (pathname === `/${legacy}` || pathname.startsWith(`/${legacy}/`)) {
      const rest = pathname.slice(legacy.length + 1) || "/";
      const target = new URL(`/fr${rest === "/" ? "" : rest}${search}`, req.url);
      mwLog.info(`redirect ${pathname} → ${target.pathname}`);
      return NextResponse.redirect(target, 308);
    }
  }

  const res = intlMiddleware(req);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    mwLog.debug(`${req.method} ${pathname}`, { ms: Math.round(performance.now() - t0), supa: "no-env" });
    return res;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          req.cookies.set(name, value);
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  let authUserId: string | null = null;
  try {
    // Refresh the token if needed. We also keep the user id so the KYC
    // gate below doesn't have to round-trip to getUser() again.
    const { data } = await supabase.auth.getUser();
    authUserId = data.user?.id ?? null;
  } catch (err) {
    mwLog.warn(`session refresh failed: ${err instanceof Error ? err.message : err}`);
  }

  // KYC entry-page gate. Verified/in-flight users hitting any step of
  // the wizard get bounced to /kyc/status server-side so they never see
  // the start screen flash. Match `/<locale>/kyc/(start|id-front|id-back|
  // selfie|processing)` — we leave /kyc/status itself alone so the
  // verified UI can render there.
  const kycMatch = pathname.match(
    /^\/(fr|ar|en)\/kyc\/(start|id-front|id-back|selfie|processing)\/?$/,
  );
  if (kycMatch && authUserId) {
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("kyc_status")
        .eq("id", authUserId)
        .single();
      const s = profile?.kyc_status;
      if (s === "verified" || s === "submitted" || s === "pending") {
        const target = new URL(`/${kycMatch[1]}/kyc/status`, req.url);
        mwLog.info(`kyc-gate ${pathname} → ${target.pathname} (status=${s})`);
        return NextResponse.redirect(target, 307);
      }
    } catch (err) {
      mwLog.warn(`kyc-gate lookup failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  mwLog.debug(`${req.method} ${pathname}`, { ms: Math.round(performance.now() - t0) });
  return res;
}

export const config = {
  // Skip Next internals, API routes, and any path with a file extension
  // (static assets). Everything else routes through the i18n + auth
  // refresh pipeline.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
