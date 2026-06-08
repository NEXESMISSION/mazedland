import { NextResponse } from "next/server";
import { log } from "@/lib/log";

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
  // Always attach a short correlation id. A user-reported failure ("I got
  // `payout_failed`, requestId 3f9a1c0b") then maps to exactly one server
  // log line — the only bridge across the redaction boundary, since the real
  // cause never crosses to the client.
  const rid = requestId ?? crypto.randomUUID().slice(0, 8);
  if (err !== undefined) {
    const msg = err instanceof Error ? err.message : String(err);
    apiLog.error(code, { requestId: rid, msg });
  }
  return NextResponse.json({ error: code, requestId: rid }, { status });
}
