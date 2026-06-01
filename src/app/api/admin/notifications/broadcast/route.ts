import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { logAction } from "@/lib/activity";

/**
 * Admin compose + broadcast notification.
 *
 * Body:
 *   {
 *     kind:  string,    // free-form tag for icon (e.g. "announcement")
 *     title: string,
 *     body?: string,
 *     link?: string,
 *     audience: {
 *       type: "all" | "role" | "users",
 *       role?: "individual" | "agency" | "bank" | "bailiff" | "inspector" | "admin",
 *       ids?: string[],
 *     },
 *     test?: boolean,   // if true, override audience to [caller_id] for dry-run
 *   }
 *
 * Authorization: same-origin + role=admin. The SQL RPC is additionally
 * SECURITY DEFINER + is_admin() guarded — we call it on the user-bound
 * client so `auth.uid()` / `auth.jwt()` reach the function and the
 * admin check re-validates against the caller's session (defense in
 * depth: a forged route-level role check still gets blocked at the DB).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const kind = typeof body.kind === "string" ? body.kind.trim().slice(0, 64) : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const text = typeof body.body === "string" ? body.body.trim().slice(0, 1000) : "";
  const link = typeof body.link === "string" ? body.link.trim().slice(0, 500) : "";
  // Kind-specific extras land in notifications.payload (jsonb). Schema
  // is enforced client-side per kind; here we just validate the shape
  // is an object and cap the size so a misbehaving client can't push
  // megabytes into the column.
  const rawPayload = body.payload;
  const payload =
    rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
      ? sanitizePayload(rawPayload as Record<string, unknown>)
      : {};
  const test = body.test === true;

  if (!kind) return NextResponse.json({ error: "kind_required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

  let audience = body.audience as
    | { type: "all" }
    | { type: "role"; role: string }
    | { type: "users"; ids: string[] }
    | undefined;

  if (test) {
    // Test send always overrides to the caller — keeps the dry-run safe.
    audience = { type: "users", ids: [user.id] };
  }

  if (!audience || typeof audience.type !== "string") {
    return NextResponse.json({ error: "audience_required" }, { status: 400 });
  }
  if (audience.type === "users") {
    const ids = Array.isArray(audience.ids) ? audience.ids : [];
    const cleanIds = ids
      .filter((x): x is string => typeof x === "string" && x.length > 0)
      .slice(0, 500);
    if (cleanIds.length === 0) {
      return NextResponse.json({ error: "ids_required" }, { status: 400 });
    }
    audience = { type: "users", ids: cleanIds };
  } else if (audience.type === "role") {
    const ROLES = ["individual", "agency", "bank", "bailiff", "inspector", "admin"];
    if (!ROLES.includes(audience.role)) {
      return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    }
  } else if (audience.type !== "all") {
    return NextResponse.json({ error: "invalid_audience_type" }, { status: 400 });
  }

  // Call on the user-bound client so the RPC's is_admin() check sees
  // the admin's JWT. The function is SECURITY DEFINER, so the actual
  // fan-out INSERT runs with elevated privileges anyway — no need to
  // wrap with the service role here.
  const { data, error } = await supabase.rpc("broadcast_notification", {
    p_kind: kind,
    p_title: title,
    p_body: text,
    p_link: link,
    p_audience: audience,
    p_payload: payload,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!test) {
    logAction(req, user, "notification.broadcast", { kind, audience: audience.type });
  }
  return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
}

/**
 * Strip incoming payload values to safe shapes: strings capped at 500
 * chars, numbers passed through, booleans passed through, anything
 * deeper (arrays/objects) dropped. The kind-specific UIs only emit
 * flat string/number/boolean primitives, so this matches.
 */
function sanitizePayload(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= 20) break; // hard cap on keys
    if (typeof key !== "string" || key.length === 0 || key.length > 64) continue;
    if (typeof value === "string") {
      out[key] = value.slice(0, 500);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else {
      continue;
    }
    count++;
  }
  return out;
}
