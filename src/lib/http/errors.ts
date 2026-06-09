import { NextResponse } from "next/server";
import { log } from "@/lib/log";
import { getRequestId } from "@/lib/observability/requestContext";

const apiLog = log.scope("api");

/**
 * Single redaction point for API error responses.
 *
 * Returns a STABLE machine code to the client and logs the real
 * Postgres/PostgREST message server-side. Raw DB error strings embed table /
 * column / constraint / function names (schema recon) and sometimes data
 * (e.g. a balance figure in a RAISE detail) — none of that may cross to a
 * caller, admin or otherwise. Every API route should return errors through
 * `fail()` instead of `{ error: someError.message }`.
 *
 *   if (error) return fail("payout_failed", 500, error);
 *
 * `requestId` (optional) ties the client-visible response to the server log
 * line so a user-reported failure is locatable.
 */
export function fail(
  code: string,
  status: number,
  err?: unknown,
  requestId?: string,
): NextResponse {
  // Always attach a short correlation id. Prefer the per-request id from the
  // withRouteLogger AsyncLocalStorage (so the client-visible id matches EVERY
  // server log line for that request), then an explicit arg, then a per-call
  // fallback. A user-reported failure ("I got `payout_failed`, requestId
  // 3f9a1c0b") maps to the server logs across the redaction boundary.
  const rid = requestId ?? getRequestId() ?? crypto.randomUUID().slice(0, 8);
  if (err !== undefined) {
    const msg = err instanceof Error ? err.message : String(err);
    apiLog.error(code, { requestId: rid, msg });
  }
  return NextResponse.json({ error: code, requestId: rid }, { status });
}
