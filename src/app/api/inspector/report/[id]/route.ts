import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Stream an inspection report PDF to a permitted reader. The storage
 * bucket is private, so we sign a short-lived URL on the server (which
 * authenticates as the user via the SSR cookie) and 302 to it.
 *
 * RLS on storage.objects gates who can fetch — we don't repeat that
 * authorization here. If the caller doesn't pass storage RLS, the
 * signed-URL request fails and we return 403 + a useful message.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await getServerSupabase();

  const { data: ins } = await supabase
    .from("inspections")
    .select("report_pdf_path")
    .eq("id", id)
    .single();
  if (!ins?.report_pdf_path) {
    return NextResponse.json({ error: "no_report" }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("inspection-reports")
    .createSignedUrl(ins.report_pdf_path, 60); // 60-second URL — re-fetched on every link tap
  if (error || !signed) {
    // Don't echo the raw storage error to the client (path/bucket recon).
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
