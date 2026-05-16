import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Stream a property legal document (titre foncier, permis de bâtir, etc.)
 * to a permitted reader. Storage RLS on the `property-documents` bucket
 * enforces who can fetch — we sign a 60s URL via the SSR-cookie-bound
 * client so the policy sees the active user.
 *
 * The DB-side `property_documents` row policy gates who can SELECT here:
 *   - the property owner (for their own admin)
 *   - admins
 *   - any KYC-verified bidder with an active deposit on the auction
 *
 * If the policy denies, the .from() lookup returns no row and we 404.
 * If the policy allows but storage RLS denies (path mismatch), the
 * sign call fails and we return 403.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await getServerSupabase();

  const { data: doc } = await supabase
    .from("property_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!doc?.storage_path) {
    return NextResponse.json({ error: "not_found_or_forbidden" }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from("property-documents")
    .createSignedUrl(doc.storage_path, 60);
  if (error || !signed) {
    return NextResponse.json(
      { error: "storage_forbidden", detail: error?.message },
      { status: 403 },
    );
  }
  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
