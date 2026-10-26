import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { isSocialChannel } from "@/lib/social/channels";
import { instagramCrop } from "@/lib/social/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/social/image/:requestId/:n?c=instagram — photo n of an approved
 * promotion, as a JPEG Meta can download.
 *
 * Listing photos are stored as WebP, and Instagram only takes JPEG at a
 * public URL; Facebook gets the same file. For Instagram the photo is also
 * brought inside the 4:5 – 1.91:1 frame it accepts (centred crop).
 *
 * Public, because Meta's servers fetch it without a session — but only for a
 * request an admin approved, so this is not an open image converter. The
 * request id is a uuid nobody can guess.
 */
const SERVABLE = ["scheduled", "published"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ requestId: string; n: string }> }) {
  const { requestId, n } = await params;
  const index = Number(n);
  const channel = req.nextUrl.searchParams.get("c") ?? "facebook_page";
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !Number.isInteger(index) || index < 0 || index > 9 || !isSocialChannel(channel)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });

  const { data: req0 } = await admin
    .from("social_publication_requests")
    .select("status")
    .eq("id", requestId)
    .maybeSingle();
  if (!req0 || !SERVABLE.includes(req0.status as string)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { data: variant } = await admin
    .from("social_content_variants")
    .select("photo_paths")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .maybeSingle();
  const path = (variant?.photo_paths as string[] | undefined)?.[index];
  if (!path) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Uploads live in storage; the imported catalogue's photos are files the
  // site itself serves (/properties/…).
  const src = propertyPhotoUrl(path);
  const source = await fetch(src.startsWith("/") ? new URL(src, req.nextUrl.origin) : src, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!source?.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    // Upright first, so the crop is computed on the photo as it is seen.
    const upright = await sharp(Buffer.from(await source.arrayBuffer()), { failOn: "none" })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    let img = sharp(upright.data);
    const crop = channel === "instagram" ? instagramCrop(upright.info.width, upright.info.height) : null;
    if (crop) img = img.extract(crop);
    const out = await img
      .resize({ width: 1440, height: 1440, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return new Response(new Uint8Array(out), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "decode_failed" }, { status: 422 });
  }
}
