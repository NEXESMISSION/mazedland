import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { trackedUrl } from "@/lib/social/content";

export const dynamic = "force-dynamic";

/**
 * /p/1A2B3C — the short link an Instagram caption carries, since a caption
 * cannot carry a real one. It opens the annonce with Instagram's UTM tags,
 * so the visit counts for the post that brought it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ locale: string; ref: string }> }) {
  const { locale, ref } = await params;
  const home = new URL(`/${locale}`, req.nextUrl.origin);
  if (!/^[0-9a-f]{6}$/i.test(ref)) return NextResponse.redirect(home);

  const admin = getServiceSupabase();
  if (!admin) return NextResponse.redirect(home);
  const { data } = await admin
    .from("social_publication_requests")
    .select("listing_id, ref")
    .eq("ref", ref.toUpperCase())
    .in("status", ["scheduled", "published"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return NextResponse.redirect(home);

  return NextResponse.redirect(
    trackedUrl(req.nextUrl.origin, data.listing_id as string, {
      ref: data.ref as string,
      channel: "instagram",
      language: locale === "ar" ? "ar" : "fr",
    }),
  );
}
