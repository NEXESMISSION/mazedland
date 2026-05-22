import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

/**
 * Admin shell — gated to role=admin. Two layouts in parallel:
 *
 *   Mobile (< lg): the original single-column shell with the brand
 *     mark + horizontal AdminTabs (5 hubs + sub-tab row).
 *
 *   Desktop (lg+): a console-style two-column layout — sticky left
 *     sidebar (AdminSidebar, every surface visible at a glance) +
 *     wide main canvas (up to 1600px). The brand chrome moves into
 *     the sidebar header so the main area maximises content area.
 *
 * Mobile keeps AdminTabs rendered; desktop hides them via `lg:hidden`
 * so we never paint both navigations at the same time.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user!.id)
    .single();

  if (profile?.role !== "admin") {
    redirect({ href: "/", locale: locale as "ar" | "fr" | "en" });
  }

  return (
    <div className="lg:flex lg:min-h-screen lg:bg-[var(--surface-2)]">
      <AdminSidebar />

      <div className="flex-1 lg:min-w-0">
        {/* Mobile-only header — the desktop equivalent lives inside
            AdminSidebar so the main area is uninterrupted. */}
        <div className="lg:hidden">
          <div className="mx-auto max-w-[var(--max-w)] px-4 py-5">
            <header className="mb-3 flex items-baseline justify-between">
              <Link href="/admin" className="flex items-center gap-2">
                <span className="batta-eyebrow">Admin console</span>
                <span className="batta-gold-rule-short" aria-hidden />
              </Link>
              <Link
                href="/"
                className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted hover:text-gold-bright"
              >
                ← Exit
              </Link>
            </header>

            <h1 className="text-[22px] font-extrabold leading-tight tracking-tight">
              <span className="gradient-gold-text">Batta · Admin</span>
            </h1>

            <AdminTabs />
          </div>
        </div>

        {/* Main canvas — mobile pads itself (the wrapper above sets
            the page width); desktop wraps the children in a sticky
            top bar + wider canvas. */}
        <main className="lg:mx-auto lg:max-w-[1600px] lg:px-8 lg:py-6">
          {/* Top bar shown on desktop only. Carries the page-level
              greeting + a quick "Sortir" link (already in sidebar
              footer, but having one near the content is faster on
              wide screens). */}
          <div className="hidden lg:mb-5 lg:flex lg:items-center lg:justify-between lg:gap-3">
            <div>
              <span className="batta-eyebrow text-[10px]">Admin console</span>
              <h1 className="mt-0.5 text-[20px] font-extrabold leading-tight tracking-tight text-foreground">
                Bonjour
                {profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
                <span className="ms-1 text-muted font-normal">·</span>
                <span className="ms-1 gradient-gold-text">Tableau de bord</span>
              </h1>
            </div>
          </div>

          <div className="mx-auto max-w-[var(--max-w)] px-4 pb-8 lg:max-w-none lg:px-0 lg:pb-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
