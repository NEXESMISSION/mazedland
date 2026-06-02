import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminSidebar, AdminMobileBar } from "@/components/admin/AdminSidebar";

/**
 * Admin console — gated to role=admin. Responsive shell: a sticky left rail on
 * desktop (lg+), a top bar + slide-over drawer on mobile/tablet. The consumer
 * chrome (TopBar / DesktopNav / BottomTabBar) is suppressed for /admin in
 * MobileShell, so this is the whole shell.
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
    .select("role")
    .eq("id", user!.id)
    .single();

  if (profile?.role !== "admin") {
    redirect({ href: "/", locale: locale as "ar" | "fr" | "en" });
  }

  return (
    <div className="flex min-h-screen bg-surface">
      <AdminSidebar />
      <main className="min-w-0 flex-1">
        <AdminMobileBar />
        <div className="mx-auto max-w-[1320px] px-4 py-6 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
