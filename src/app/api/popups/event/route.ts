import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { fail } from "@/lib/http/errors";

/**
 * Records a popup-lifecycle event: an impression (the user saw the
 * popup), a dismiss (closed without acting), or a click (followed the
 * primary CTA). The DB RPC upserts a `popup_views` row keyed on
 * (popup_id, user_id), so calling impression repeatedly just bumps the
 * counter; dismiss / click stamp dedicated columns once.
 *
 * Anonymous users intentionally fail silently — their dismissal state
 * lives in localStorage. See migration 0053 for the rationale.
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    popup_id?: string;
    kind?: string;
  };
  const popup_id = typeof body.popup_id === "string" ? body.popup_id : "";
  const kind = body.kind;

  if (!popup_id) {
    return NextResponse.json({ error: "popup_id_required" }, { status: 400 });
  }
  // A junk id reached the database and came back as a 500 (« popup_event_failed »)
  // — a visitor's stale script, not a fault of ours. Not even a uuid: 400.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(popup_id)) {
    return NextResponse.json({ error: "invalid_popup_id" }, { status: 400 });
  }
  if (kind !== "impression" && kind !== "dismiss" && kind !== "click") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("record_popup_event", {
    p_popup_id: popup_id,
    p_kind: kind,
  });

  if (error) {
    // A popup that no longer exists (deleted after the page loaded): nothing
    // to record, and nothing for the visitor to do about it.
    if (error.code === "23503" || error.code === "P0002" || /not found|does not exist/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "popup_not_found" }, { status: 404 });
    }
    return fail("popup_event_failed", 500, error);
  }
  return NextResponse.json({ ok: true });
}
