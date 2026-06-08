import { NextRequest, NextResponse } from "next/server";
import { log } from "./log";

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
    try {
      const res = await handler(req, ctx);
      const ms = Math.round(performance.now() - t0);
      const line = `${tag} ${res.status}`;
      if (res.status >= 500) routeLog.error(line, { ms });
      else if (res.status >= 400) routeLog.warn(line, { ms });
      else routeLog.info(line, { ms });
      return res;
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      routeLog.error(`${tag} threw`, { ms, err: err instanceof Error ? err.message : String(err) });
      // Log the real message server-side (above) but DON'T leak it to the
      // client — raw Postgres/PostgREST errors expose table/column/constraint
      // names useful for schema recon.
      return NextResponse.json(
        { error: "internal_error" },
        { status: 500 },
      );
    }
  };
}
