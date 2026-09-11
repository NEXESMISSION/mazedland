/**
 * Supabase session cookies, recognised by name.
 *
 * @supabase/ssr keeps the session in `sb-<project-ref>-auth-token`, split into
 * `.0`, `.1`… chunks once it outgrows a single cookie. The name is enough to
 * tell a visitor who has a session from one who does not; whether that session
 * is still valid is the Supabase client's call.
 */
export function isSupabaseAuthCookie(name: string): boolean {
  return name.startsWith("sb-") && name.includes("-auth-token");
}

/**
 * Whether a `Cookie` string carries a Supabase session. Defaults to
 * `document.cookie`, which does see these cookies: @supabase/ssr writes them
 * without HttpOnly so its browser client can read them, and nothing in this
 * app overrides that.
 *
 * The header chrome mounts on every page for every visitor. Asking this first
 * lets it leave out, for a guest, the Supabase client bundle and the requests
 * whose only possible answer is "nobody is signed in".
 */
export function hasSupabaseSessionCookie(
  cookies: string = typeof document === "undefined" ? "" : document.cookie,
): boolean {
  return cookies.split(";").some((pair) => {
    const eq = pair.indexOf("=");
    return isSupabaseAuthCookie((eq === -1 ? pair : pair.slice(0, eq)).trim());
  });
}
