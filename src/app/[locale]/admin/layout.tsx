import { redirect } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/admin/session";
import { AdminRail, AdminMobileBar, type AdminCounts } from "@/components/admin/AdminShell";

// Admin is auth-gated and per-request — never static. Forcing dynamic here
// covers EVERY admin route (so a new page can't accidentally be prerendered,
// which would run this layout's Supabase calls at build and fail when no
// Supabase env is present, e.g. CI without secrets).
export const dynamic = "force-dynamic";

/**
 * Admin console shell — ported from Mazed Auto, in Batta's colours.
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
  const countsPromise = Promise.all([
    head("listings")?.eq("status", "pending_review") ?? Promise.resolve({ count: 0 }),
    head("payments")?.eq("status", "pending_review") ?? Promise.resolve({ count: 0 }),
    // Cautions waiting to be returned: released to us, not yet refunded or
    // forfeited. This is the queue that is holding other people's money.
    head("auction_deposits")?.not("released_at", "is", null).is("refunded_at", null).is("forfeited_at", null)
      ?? Promise.resolve({ count: 0 }),
    head("kyc_submissions")?.eq("status", "submitted") ?? Promise.resolve({ count: 0 }),
    head("properties")?.eq("status", "pending_review") ?? Promise.resolve({ count: 0 }),
  ]);

  const { locale } = await params;
  const { user, isAdmin } = await getAdminSession();

  if (!user) redirect({ href: "/login", locale: locale as "fr" });
  if (!isAdmin) redirect({ href: "/", locale: locale as "fr" });

  const [annonces, paiements, cautions, kyc, lots] = await countsPromise;
  const counts: AdminCounts = {
    annonces: annonces.count ?? 0,
    paiements: paiements.count ?? 0,
    cautions: cautions.count ?? 0,
    kyc: kyc.count ?? 0,
    lots: lots.count ?? 0,
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
