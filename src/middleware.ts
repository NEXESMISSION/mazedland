import createIntlMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { log } from "./lib/log";
import { logActivity } from "./lib/activity";

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

  // Prefetch requests (Next router prefetch on hover/viewport) only warm the
  // client cache — they should NOT trigger the auth-token refresh, the gate
  // redirects (a prefetch never follows them), or activity logging. The real
  // navigation re-runs this middleware in full. Skipping here both speeds up
  // prefetch and avoids many background prefetches racing on token refresh.
  const isPrefetch =
    req.headers.get("next-router-prefetch") === "1" ||
    req.headers.get("purpose") === "prefetch" ||
    req.headers.get("x-purpose") === "prefetch";
  if (isPrefetch) {
    mwLog.debug(`prefetch ${pathname} · auth skipped`, {
      ms: Math.round(performance.now() - t0),
    });
    return res;
  }

  // Anonymous visitors have no Supabase auth cookie, so there is no token
  // to refresh — calling getUser() for them is a pure-waste NETWORK round
  // trip to the Auth server on EVERY page view (and it defeats the CDN on
  // otherwise-static pages). At tens of thousands of visitors this is the
  // single most-hit server cost, so we skip the whole Supabase client +
  // getUser() round-trip unless an auth-token cookie is actually present.
  // The gates below stay correct on the null-user path: the account-gate
  // still redirects anonymous users to login; the auth-page and KYC gates
  // simply no-op (they only act when authUserId is set).
  //
  // Supabase SSR stores the session in cookie(s) named
  // `sb-<project-ref>-auth-token` (sometimes chunked `.0`, `.1`), so a
  // name containing `-auth-token` reliably detects a logged-in session.
  const hasAuthCookie = req.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));

  let authUserId: string | null = null;
  let authUserEmail: string | null = null;
  let supabase: ReturnType<typeof createServerClient> | null = null;

  if (hasAuthCookie) {
    supabase = createServerClient(url, key, {
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

    const endAuth = mwLog.time(`auth.getUser ${pathname}`);
    try {
      // Refresh the token if needed. We also keep the user id so the KYC
      // gate below doesn't have to round-trip to getUser() again.
      const { data } = await supabase.auth.getUser();
      authUserId = data.user?.id ?? null;
      authUserEmail = data.user?.email ?? null;
    } catch (err) {
      mwLog.warn(`session refresh failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      endAuth();
    }
  }

  // Auth-page gate. A signed-in user has no reason to see the sign-in /
  // sign-up surfaces — bounce them to the home shell. `reset-password`
  // is deliberately excluded: Supabase's recovery link establishes a
  // temporary session, so the user IS "logged in" while legitimately
  // setting a new password there, and gating it would break recovery.
  const authPageMatch = pathname.match(
    /^\/(fr|ar|en)\/(login|signup|forgot-password)\/?$/,
  );
  if (authPageMatch && authUserId) {
    const target = new URL(`/${authPageMatch[1]}`, req.url);
    mwLog.info(`auth-gate ${pathname} → ${target.pathname}`);
    return NextResponse.redirect(target, 307);
  }

  // Private-area gate. Every /account page needs a session — an anonymous
  // visitor (e.g. tapping the account icon while signed out) is sent
  // straight to login with a `next` param so they return here afterwards.
  const accountMatch = pathname.match(/^\/(fr|ar|en)\/account(?:\/.*)?$/);
  if (accountMatch && !authUserId) {
    const next = `${pathname}${search}`;
    const target = new URL(
      `/${accountMatch[1]}/login?next=${encodeURIComponent(next)}`,
      req.url,
    );
    mwLog.info(`account-gate ${pathname} → ${target.pathname}`);
    return NextResponse.redirect(target, 307);
  }

  // KYC entry-page gate. Verified/in-flight users hitting any step of
  // the wizard get bounced to /kyc/status server-side so they never see
  // the start screen flash. Match `/<locale>/kyc/(start|id-front|id-back|
  // selfie|processing)` — we leave /kyc/status itself alone so the
  // verified UI can render there.
  const kycMatch = pathname.match(
    /^\/(fr|ar|en)\/kyc\/(start|id-front|id-back|selfie|processing)\/?$/,
  );
  if (kycMatch && authUserId && supabase) {
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

  // Activity log — record the page view (who is on the site, what page).
  // Fire-and-forget so navigation is never slowed. We log real page
  // navigations only: GET requests that aren't router prefetches. Both
  // authenticated and anonymous visits are captured (anonymous → null
  // user). The matcher already excludes /api, _next and static assets.
  // Prefetch already returned early above, so any GET reaching here is a real
  // navigation worth recording.
  if (req.method === "GET") {
    logActivity({
      type: "page_view",
      userId: authUserId,
      userEmail: authUserEmail,
      path: pathname,
      method: req.method,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
      referer: req.headers.get("referer") ?? null,
    });
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
