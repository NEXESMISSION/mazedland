import { cache } from "react";
import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * The admin gate, resolved once per request.
 *
 * Why this exists: every admin navigation was paying for the same identity
 * check three times over. The middleware calls `auth.getUser()` (a network
 * round trip to the Supabase Auth server, ~150 ms), the admin layout called it
 * again, and then looked the profile row up separately (~75 ms). Because each
 * leg depends on the one before it, that is ~375 ms of serialized network
 * before the page being navigated to has run a single query of its own — on
 * every click, since every admin route is `force-dynamic` and nothing is
 * cached.
 *
 * React's `cache()` memoizes per *request*, so the layout and the page it
 * wraps now share one resolution. It is not a cross-request cache: a revoked
 * session is still caught on the next navigation, which is the property that
 * matters for an auth check.
 *
 * `getUser()` (not `getSession()`) stays deliberately — it validates the token
 * with the auth server instead of trusting a cookie the client could have
 * written. Deduplicating it is safe; skipping it is not.
 */
export type AdminSession = {
  supabase: Awaited<ReturnType<typeof getServerSupabase>>;
  user: User | null;
  isAdmin: boolean;
};

export const getAdminSession = cache(async (): Promise<AdminSession> => {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, isAdmin: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  return { supabase, user, isAdmin: profile?.role === "admin" };
});

/**
 * The gate every admin page runs itself, before its first query.
 *
 * The admin layout redirects whoever is not an admin, but Next renders a
 * layout and its page in parallel: by the time the layout's redirect reached
 * the browser, the page had already streamed its data into the same response.
 * An anonymous `curl` of /admin/vendeurs came back with sellers' phone
 * numbers. The proxy now turns such a request away before anything renders;
 * this is the second lock, for any path the proxy's matcher does not see.
 */
export async function requireAdmin(): Promise<AdminSession & { user: User }> {
  const session = await getAdminSession();
  if (!session.user || !session.isAdmin) notFound();
  return session as AdminSession & { user: User };
}
