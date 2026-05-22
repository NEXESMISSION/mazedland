import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/optimize-image
 *
 * Body: the raw image bytes (any format sharp/libvips can decode, incl.
 * iPhone HEIC/HEIF). Returns optimized WebP bytes.
 *
 * This replaces the flaky client-side heic2any + canvas pipeline: the phone
 * uploads the original once, the server does the heavy lifting (orient,
 * downscale, WebP) and hands back a small, always-renderable image. One
 * conversion, server-side — faster on the device and ~70-90% smaller.
 *
 * Query:
 *   maxEdge = longest side in px (default 1600, clamped 64..4000)
 *   quality = WebP quality 1..100 (default 80)
 */
const MAX_BYTES = 30 * 1024 * 1024; // 30 MB raw input cap

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  // Logged-in only — this is a CPU endpoint, don't let it be hammered anon.
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.byteLength === 0) {
    return NextResponse.json({ error: "empty_body" }, { status: 400 });
  }
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const sp = req.nextUrl.searchParams;
  const maxEdge = clamp(Number(sp.get("maxEdge") ?? 1600), 64, 4000);
  const quality = clamp(Number(sp.get("quality") ?? 80), 1, 100);

  try {
    const out = await sharp(buf, { failOn: "none" })
      .rotate() // honour EXIF orientation, then strip it
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toBuffer();

    return new Response(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "decode_failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
