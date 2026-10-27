import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { AD_IMAGE, adImageExt } from "@/lib/ads/ads";

/**
 * POST /api/admin/ads/upload-url  { ext, size } → { path, signedUrl }
 *
 * A signed upload URL for one banner image, for the same reason annonce
 * photos have one (see /api/annonces/photo-url): the browser PUTs the bytes
 * with a plain `fetch`, out of the auth client's lock.
 *
 * The path is chosen here — `ads/<uuid>.<ext>` in the public `properties`
 * bucket — and only JPG, PNG and WebP. A signed URL cannot cap the bytes that
 * are sent to it, so the size is the one the console declares, checked before
 * it asks; the cap is for the admin's sake (a 12 MB photo straight off a
 * camera would slow every page it shows on), not a defence.
 */
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = (await req.json().catch(() => ({}))) as { ext?: unknown; size?: unknown };
  const t = await apiTranslator(req, "adminAds.api");
  const ext = adImageExt(String(body.ext ?? ""));
  if (!ext) return NextResponse.json({ error: "invalid", detail: t("imageType") }, { status: 400 });
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0 || size > AD_IMAGE.maxBytes) {
    return NextResponse.json(
      { error: "invalid", detail: t("imageSize", { max: Math.round(AD_IMAGE.maxBytes / 1024 / 1024) }) },
      { status: 400 },
    );
  }

  // Every URL is a write into a public bucket: a ceiling, even for an admin.
  const { data: over } = await admin.rpc("check_rate_limit", {
    p_key: `ad-upload:${user.id}`,
    p_max: 60,
    p_window_secs: 3600,
  });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const path = `ads/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from("properties").createSignedUploadUrl(path);
  if (error || !data?.signedUrl) return fail("signed_url_failed", 500, error);

  logAction(req, user, "admin.ad.upload", { path, size });
  return NextResponse.json({ ok: true, path, signedUrl: data.signedUrl });
}
