import { NextRequest, NextResponse } from "next/server";
import { log } from "./log";
import { newRequestId, runWithRequestId } from "./observability/requestContext";

const routeLog = log.scope("api");

/**
 * Compact route wrapper: emits ONE line per request with status + ms.
 *
 *   api GET /api/explore 200 · ms=446
 *   WARN api POST /api/foo 503 · ms=12
 *   ERROR api PATCH /api/foo · TypeError: …
 *
 * No separate entry log — the query string is recovered from the path
 * if needed by reading the response logs in chronological order.
 *
 * Usage:
 *   export const POST = withRouteLogger(async (req) => { ... });
 *   export const PATCH = withRouteLogger<{ id: string }>(async (req, ctx) => { ... });
 */
export function withRouteLogger<Params = unknown>(
  handler: (
    req: NextRequest,
    ctx: { params: Promise<Params> },
  ) => Promise<NextResponse> | NextResponse,
) {
  return async function loggedHandler(
    req: NextRequest,
    ctx: { params: Promise<Params> },
  ): Promise<NextResponse> {
    const t0 = performance.now();
    const tag = `${req.method} ${req.nextUrl.pathname}${req.nextUrl.search}`;
    // One id per request, shared by every log line + the error body via
    // AsyncLocalStorage — real cross-line correlation. Honor an inbound
    // x-request-id (e.g. from an upstream proxy) so a trace spans tiers.
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || newRequestId();
    return runWithRequestId(requestId, async () => {
      try {
        const res = await handler(req, ctx);
        const ms = Math.round(performance.now() - t0);
        const line = `${tag} ${res.status}`;
        if (res.status >= 500) routeLog.error(line, { ms, requestId });
        else if (res.status >= 400) routeLog.warn(line, { ms, requestId });
        else routeLog.info(line, { ms, requestId });
        res.headers.set("x-request-id", requestId);
        return res;
      } catch (err) {
        const ms = Math.round(performance.now() - t0);
        routeLog.error(`${tag} threw`, { ms, requestId, err: err instanceof Error ? err.message : String(err) });
        // Log the real message server-side (above) but DON'T leak it to the
        // client — raw Postgres/PostgREST errors expose table/column/constraint
        // names useful for schema recon.
        return NextResponse.json(
          { error: "internal_error", requestId },
          { status: 500, headers: { "x-request-id": requestId } },
        );
      }
    });
  };
}
