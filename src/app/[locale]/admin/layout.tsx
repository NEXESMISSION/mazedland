import { redirect } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/admin/session";
import { AdminRail, AdminMobileBar, type AdminCounts } from "@/components/admin/AdminShell";

// Admin is auth-gated and per-request — never static. Forcing dynamic here
// covers EVERY admin route (so a new page can't accidentally be prerendered,
// which would run this layout's Supabase calls at build and fail when no
// Supabase env is present, e.g. CI without secrets).
export const dynamic = "force-dynamic";

/** The kinds `/admin/paiements` can actually settle — the classifieds line. */
const CONSOLE_PAYMENT_KINDS = [
  "listing_fee", "listing_pack", "subscription", "promo", "badge", "renewal",
];

/**
 * Admin console shell — ported from Mazed Auto, in Mazed Immo's colours.
 *
 * The console is the classifieds console: the auction screens are no longer
 * linked from the rail (see AdminShell). The one exception is the caution
 * settlement count below, which keeps a single link alive only while there is
 * still bidder money to return.
 *
 * The console is an **application viewport**, not a document: it fills the
 * window once and scrolling happens inside panes, which is what lets a
 * split-pane screen keep its list scrolled while the detail beside it changes.
 * There is deliberately no padding or max-width here — document-shaped screens
 * opt into those with `<AdminPage>`.
 *
 * The badge counts are fired **before** the gate is awaited, against the
 * service client, so they overlap the identity check rather than queueing
 * behind it. A non-admin simply gets counts that are discarded.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const service = getServiceSupabase();
  const head = (t: string) =>
    service ? service.from(t).select("*", { count: "exact", head: true }) : null;

  // Started, not awaited — these run while the gate below resolves.
  // Started, not awaited — these run while the gate below resolves.
  //
  // The payments badge filters on kind. Every payment row Mazed Immo holds today is
  // a `deposit_lock` from the auction product, and `/admin/paiements` cannot
  // settle those — counting them would put a permanent "1" on a queue that is
  // permanently empty, which teaches an admin to ignore the badge.
  const countsPromise = Promise.all([
    head("listings")?.eq("status", "pending_review") ?? Promise.resolve({ count: 0 }),
    head("payments")
      ?.in("kind", CONSOLE_PAYMENT_KINDS)
      .eq("status", "pending_review") ?? Promise.resolve({ count: 0 }),
  ]);

  const { locale } = await params;
  const { user, isAdmin } = await getAdminSession();

  if (!user) redirect({ href: "/login", locale: locale as "fr" });
  if (!isAdmin) redirect({ href: "/", locale: locale as "fr" });

  const [annonces, paiements] = await countsPromise;
  const counts: AdminCounts = {
    annonces: annonces.count ?? 0,
    paiements: paiements.count ?? 0,
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <AdminRail counts={counts} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminMobileBar counts={counts} />
        {/* The one scroll region for document-shaped screens. Padding lives
            here so the screens not yet rebuilt keep their margins; a
            pane-based screen cancels it with FullBleed. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 lg:px-8 lg:py-7">
          {children}
        </div>
      </div>
    </div>
  );
}
