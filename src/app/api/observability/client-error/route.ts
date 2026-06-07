import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin } from "@/lib/sameOrigin";
import { log } from "@/lib/log";
import { logError } from "@/lib/activity";

const cliErr = log.scope("cer");

// Per-IP rate limit so a single client's crash-loop can't turn this sink into
// an unbounded activity_log write storm (a same-origin POST is forgeable). In
// memory / per-instance — deliberately no DB round-trip (that would add the
// very load we're capping); good enough to blunt a runaway client. Beyond the
// cap we drop the report (still 204, indistinguishable to the caller).
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20;
const rlHits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (rlHits.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (arr.length >= RL_MAX) {
    rlHits.set(ip, arr);
    return true;
  }
  arr.push(now);
  rlHits.set(ip, arr);
  if (rlHits.size > 5000) {
    for (const [k, v] of rlHits) if (v.every((t) => now - t > RL_WINDOW_MS)) rlHits.delete(k);
  }
  return false;
}

/**
 * Sink for client-side crashes (window.onerror / unhandledrejection / React
 * error boundaries). The browser POSTs a small JSON payload; we log it
 * server-side so client errors land in the SAME stream as server errors —
 * one place to watch, captured by Vercel's logs. Best-effort and cheap:
 * same-origin only, hard size caps, never throws back at the client.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Same-origin only so this can't be used as an open log-spam relay.
  if (!isSameOrigin(req)) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  // Per-IP cap so a crash-loop can't flood activity_log.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(ip)) return new NextResponse(null, { status: 204 });
  try {
    const body = (await req.json().catch(() => ({}))) as {
      message?: unknown;
      source?: unknown;
      stack?: unknown;
      url?: unknown;
      kind?: unknown;
    };
    const clip = (v: unknown, n: number) =>
      typeof v === "string" ? v.slice(0, n) : undefined;
    cliErr.error(`${clip(body.kind, 24) ?? "error"}: ${clip(body.message, 300) ?? "(no message)"}`, {
      at: clip(body.url, 200),
      source: clip(body.source, 200),
      ua: req.headers.get("user-agent")?.slice(0, 160) ?? undefined,
    });
    const stack = clip(body.stack, 2000);
    if (stack) cliErr.error(stack);
    // Persist so it shows in /admin/activity, not just the log stream.
    logError({
      action: `client.${clip(body.kind, 24) ?? "error"}`,
      path: clip(body.url, 200) ?? null,
      metadata: {
        message: clip(body.message, 300),
        source: clip(body.source, 200),
        ua: req.headers.get("user-agent")?.slice(0, 160) ?? undefined,
      },
    });
  } catch {
    // swallow — observability must never error the caller
  }
  // 204: nothing to return; keeps the beacon cheap.
  return new NextResponse(null, { status: 204 });
}
