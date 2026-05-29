import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { matchPath, type Popup } from "@/lib/popups/schema";

/**
 * Public popup matcher — returns the active popups for a given path,
 * locale and device. Called by `<PopupManager />` on every route change.
 *
 * Authentication is implicit through the user's session cookie: the
 * matcher RPC reads `auth.uid()` to apply role / user_ids filtering, so
 * the same endpoint serves anon and logged-in users transparently.
 *
 * Returned shape: `{ items: Popup[] }` already filtered by:
 *   - status=live
 *   - schedule window (broadcasts)
 *   - locale / device
 *   - audience scope + role membership + user_ids
 *   - page glob patterns (done here, not in SQL, so the matcher is
 *     consistent with the admin preview and the negation `!` syntax)
 *
 * The client then applies the per-user `popup_views` frequency cap
 * before showing anything — that read lives client-side to avoid an
 * extra round-trip on every navigation.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    path?: string;
    locale?: string;
    device?: "mobile" | "desktop" | "both";
  };

  const path = typeof body.path === "string" ? body.path.slice(0, 500) : "/";
  const locale = (body.locale === "ar" || body.locale === "en" ? body.locale : "fr");
  const device =
    body.device === "mobile" || body.device === "desktop" ? body.device : "both";

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("match_popups", {
    p_path: path,
    p_locale: locale,
    p_device: device,
  });

  if (error) {
    // Soft-fail: PopupManager treats an error as "nothing to show" rather
    // than blocking the page render. Surface the message so a misbehaving
    // matcher can be debugged from the network panel.
    return NextResponse.json({ items: [], error: error.message }, { status: 200 });
  }

  // Apply the page glob filter here in JS so the syntax (including the
  // `!/foo` negation) is consistent with the admin preview. The RPC
  // already pre-filtered everything else, so this is a small in-memory
  // pass over a short list (typically ≤ a handful of popups).
  const rows = (data ?? []) as Popup[];
  const items = rows.filter((p) => matchPath(path, p.pages ?? []));

  return NextResponse.json({ items });
}
