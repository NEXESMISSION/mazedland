import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

/**
 * Server-side sign-out — clears the Supabase auth cookie via the SSR
 * client so the next server-rendered page sees the user as anonymous
 * immediately. The browser SDK's local signOut() doesn't touch cookies,
 * which is why the account page rendered the signed-in state for one
 * extra navigation after a client-only logout.
 *
 * Returns either a 303 redirect (for plain `<form action method="POST">`
 * callers — the account page does this) or `{ ok: true }` JSON when the
 * caller sets `Accept: application/json`.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  try {
    const supabase = await getServerSupabase();
    await supabase.auth.signOut();
  } catch {
    // Even if signOut fails (no env, stale session) we still want the
    // user out of the signed-in surface, so we fall through to redirect.
  }

  // JSON callers (fetch-based) get the simple ack.
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }

  // Plain HTML form: preserve the user's current locale segment from
  // the referer so an FR/EN user doesn't land on the AR landing.
  let target = "/";
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      const u = new URL(referer);
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg === "ar" || seg === "fr" || seg === "en") target = `/${seg}`;
    } catch {
      /* ignore */
    }
  }
  return NextResponse.redirect(new URL(target, req.url), { status: 303 });
}
