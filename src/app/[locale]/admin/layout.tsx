import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { AdminTabs } from "@/components/admin/AdminTabs";

/**
 * Admin shell — gated to role=admin. The whole IA (5 hubs + contextual
 * sub-tabs) lives in <AdminTabs />.
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
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-5 lg:max-w-[var(--max-w-wide)] lg:px-8">
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

      <main>{children}</main>
    </div>
  );
}
