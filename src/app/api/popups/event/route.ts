import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";

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
  if (kind !== "impression" && kind !== "dismiss" && kind !== "click") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("record_popup_event", {
    p_popup_id: popup_id,
    p_kind: kind,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
