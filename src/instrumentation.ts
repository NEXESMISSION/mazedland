import { log } from "@/lib/log";
import { logError } from "@/lib/activity";
import { checkSupabaseRef } from "@/lib/supabase/guard";

const errLog = log.scope("err");

/**
 * Boot hook — Next.js calls this once per server instance. We use it to surface
 * a WRONG-DATABASE misconfig (a deploy wired to a sibling app's Supabase project)
 * loudly and immediately in the log. The Supabase client factories ALSO hard-throw
 * on use (see lib/supabase/guard.ts); this is the early, can't-miss signal.
 */
export function register(): void {
  const problem = checkSupabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (problem) errLog.error(`[db-guard] ${problem}`);
}

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

  // Persist to activity_log (type='error') so it's queryable + visible in
  // /admin/activity, not just in the log stream. Fire-and-forget.
  logError({
    action: `server.${context.routeType || "error"}`,
    path: request.path,
    metadata: {
      method: request.method,
      name: e?.name ?? "Error",
      message: (e?.message ?? String(error)).slice(0, 500),
      digest: e?.digest,
      route: context.routePath,
    },
  });
}
