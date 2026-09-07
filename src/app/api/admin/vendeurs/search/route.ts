import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { fail } from "@/lib/http/errors";

/**
 * Seller lookup for the admin's "créer une annonce" form.
 *
 * The form used to be handed every profile in the database as a prop — 500 of
 * them on the current cap — and filtered client-side, listing them all before
 * a single character was typed. That is a wall of names at 23 users and an
 * unusable one at 5 000, and it made every visit to the page pay for a
 * 500-row query nobody had asked for yet.
 *
 * Searching server-side means the page loads nothing, the network carries at
 * most eight rows, and the ceiling is Postgres's rather than the browser's.
 */

const LIMIT = 8;
const MIN_CHARS = 2;

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  // PostgREST's `or()` takes a comma-separated filter string, so the
  // characters that delimit it have to leave the term or they change the query.
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  const q = raw.replace(/[,()*%]/g, " ").trim();
  if (q.length < MIN_CHARS) return NextResponse.json({ sellers: [] });

  // A phone is typed with spaces, dashes or a +216 the stored value may not
  // have; matching on digits alone is what makes "58 415 520" find the account.
  const digits = q.replace(/\D/g, "");
  const filters = [`full_name.ilike.%${q}%`];
  if (digits.length >= 3) filters.push(`phone.ilike.%${digits}%`);

  const { data, error } = await admin
    .from("profiles")
    .select("id, full_name, phone")
    .is("deleted_at", null)
    .is("banned_at", null)
    .or(filters.join(","))
    .order("full_name")
    .limit(LIMIT);

  if (error) return fail("seller_search_failed", 500, error);

  return NextResponse.json({
    sellers: (data ?? []).map((p) => ({
      id: p.id as string,
      name: (p.full_name as string | null) ?? "Sans nom",
      phone: (p.phone as string | null) ?? null,
    })),
  });
}
