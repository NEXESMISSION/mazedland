import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { log } from "@/lib/log";

/**
 * Signed upload URLs for annonce photos.
 *
 * WHY this exists instead of the browser uploading with supabase-js — the same
 * reason receipts got one (see /api/payments/[id]/receipt-url):
 *
 * Every supabase-js call that needs an access token, `storage.upload()`
 * included, goes through the auth client, which serialises on a Web Locks lock
 * named `lock:sb-<ref>-auth-token`. That lock is per-ORIGIN, shared with every
 * other tab open on the site. One stalled auth operation anywhere — a
 * backgrounded tab, a request that never settles on a flaky mobile connection —
 * leaves the lock held and every later call queues behind it forever. The
 * seller sees photos that sit there and never finish, then a timeout for a
 * transfer that takes under a second when it actually runs.
 *
 * A signed URL takes the browser's auth client out of the path entirely: this
 * route mints the URL server-side, where the session is a cookie rather than a
 * lock, and the browser PUTs the bytes with a plain `fetch` — which also gives
 * it a real AbortSignal, so a stalled send can be cancelled and retried for
 * real instead of hanging.
 *
 * The PATH is chosen HERE, never by the client: `<userId>/annonce-…`, matching
 * the owner-scoped storage RLS. A forged body cannot write outside the
 * caller's own folder.
 *
 * POST { exts: string[] } → { uploads: [{ path, signedUrl }] }
 */

const MAX_PER_REQUEST = 12;
const SAFE_EXT = /^[a-z0-9]{1,5}$/;

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }

  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { exts?: unknown };
  const rawExts: unknown[] = Array.isArray(body.exts) ? body.exts : [];
  const exts = rawExts
    .map((e) => String(e ?? "").toLowerCase())
    .map((e) => (SAFE_EXT.test(e) ? e : "webp"))
    .slice(0, MAX_PER_REQUEST);
  if (exts.length === 0) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  const stamp = Date.now();
  const uploads: { path: string; signedUrl: string }[] = [];
  for (let i = 0; i < exts.length; i++) {
    const path = `${user.id}/annonce-${stamp}-${Math.round(Math.random() * 1e6)}-${i}.${exts[i]}`;
    const { data, error } = await admin.storage
      .from("properties")
      .createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      log.scope("api").error("annonce photo signed-url failed", { msg: error?.message });
      return NextResponse.json({ error: "signed_url_failed" }, { status: 500 });
    }
    uploads.push({ path, signedUrl: data.signedUrl });
  }

  return NextResponse.json({ uploads });
}
