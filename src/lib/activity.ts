import type { NextRequest } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";

/**
 * Activity / audit logging. Writes to the `activity_log` table via the
 * service-role client (bypasses RLS). Every helper here is best-effort
 * and fire-and-forget: it never throws and never blocks the caller's
 * response, so a logging hiccup can't take down a real request. See
 * migration 0056_activity_log.sql for the schema.
 */

const aLog = log.scope("act");

export type ActivityType = "page_view" | "action" | "error";

export type ActivityRecord = {
  type: ActivityType;
  userId?: string | null;
  userEmail?: string | null;
  action?: string | null;
  path?: string | null;
  method?: string | null;
  status?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  referer?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Insert one activity row. Fire-and-forget — the promise is intentionally
 * not awaited so navigations and API responses are never slowed. Errors
 * (including a missing service key on dev clones) are swallowed after a
 * warning; logging must never break the app.
 */
export function logActivity(rec: ActivityRecord): void {
  const admin = getServiceSupabase();
  if (!admin) return; // env not configured (dev clone) — silently skip

  void admin
    .from("activity_log")
    .insert({
      type: rec.type,
      user_id: rec.userId ?? null,
      user_email: rec.userEmail ?? null,
      action: rec.action ?? null,
      path: rec.path ?? null,
      method: rec.method ?? null,
      status: rec.status ?? null,
      ip: rec.ip ?? null,
      user_agent: rec.userAgent ?? null,
      referer: rec.referer ?? null,
      metadata: rec.metadata ?? {},
    })
    .then(({ error }) => {
      if (error) aLog.warn(`insert failed: ${error.message}`);
    });
}

/**
 * Persist an error to activity_log (type='error') so it's queryable and shows
 * up in the /admin/activity viewer, not just in ephemeral logs. Fire-and-forget
 * like the rest — observability must never break the request. `action` carries
 * a short label/scope (e.g. "server.500", "client.unhandledrejection") and
 * metadata carries the message/stack/digest.
 */
export function logError(rec: {
  action: string;
  path?: string | null;
  status?: number | null;
  userId?: string | null;
  userEmail?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  logActivity({
    type: "error",
    action: rec.action,
    path: rec.path ?? null,
    status: rec.status ?? null,
    userId: rec.userId ?? null,
    userEmail: rec.userEmail ?? null,
    metadata: rec.metadata ?? {},
  });
}

/** Pull the best-effort client metadata (IP, UA, referer) off a request. */
export function reqMeta(req: NextRequest): Pick<ActivityRecord, "ip" | "userAgent" | "referer"> {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: req.headers.get("user-agent") ?? null,
    referer: req.headers.get("referer") ?? null,
  };
}

/**
 * Convenience for API routes: record a meaningful action in one line.
 * Pass the authenticated user (or null), a dotted action name, and any
 * structured details. Status defaults to 200.
 */
export function logAction(
  req: NextRequest,
  user: { id: string; email?: string | null } | null,
  action: string,
  metadata: Record<string, unknown> = {},
  status = 200,
): void {
  logActivity({
    type: "action",
    action,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    path: req.nextUrl?.pathname ?? null,
    method: req.method,
    status,
    metadata,
    ...reqMeta(req),
  });
}
