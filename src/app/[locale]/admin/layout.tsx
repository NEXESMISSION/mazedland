import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

/**
 * Admin console — gated to role=admin. Desktop-only, single layout: a
 * sticky left sidebar (the only navigation) + a wide content canvas.
 * The consumer chrome (TopBar / DesktopNav / BottomTabBar) is suppressed
 * for /admin in MobileShell, so this is the whole shell — clean and
 * uncluttered, no second navigation stacked on top.
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
        <div className="mx-auto max-w-[1320px] px-10 py-10">{children}</div>
      </main>
    </div>
  );
}
