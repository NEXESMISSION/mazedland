import { log } from "@/lib/log";

const errLog = log.scope("err");

/**
 * Next.js server-side error hook. Fires for every uncaught error in a Server
 * Component, route handler, middleware, or server action — the things that
 * otherwise vanish into a generic 500 with no trace in production.
 *
 * We emit a single structured ERROR line (captured by Vercel's log stream /
 * any log drain) with the request context needed to actually find and fix it:
 * the path, method, the route phase it blew up in, and the `digest` Next shows
 * the user so a bug report ("I saw error abc123") maps straight to a log line.
 *
 * This is the zero-dependency backbone of observability; a hosted error
 * tracker (Sentry et al.) can be layered on later by also calling it here.
 */
export async function onRequestError(
  error: unknown,
  request: {
    path: string;
    method: string;
    headers: { [k: string]: string | string[] | undefined };
  },
  context: {
    routerKind: string;
    routePath: string;
    routeType: string;
    renderSource?: string;
  },
): Promise<void> {
  const e = error as { message?: string; digest?: string; stack?: string; name?: string };
  const ua = request.headers["user-agent"];
  errLog.error(`${request.method} ${request.path} — ${e?.name ?? "Error"}: ${e?.message ?? String(error)}`, {
    digest: e?.digest,
    routeType: context.routeType,
    routerKind: context.routerKind,
    routePath: context.routePath,
    ua: Array.isArray(ua) ? ua[0] : ua,
  });
  // Preserve the stack on its own line for grep-ability.
  if (e?.stack) errLog.error(e.stack);
}
