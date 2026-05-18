import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import {
  LayoutDashboard,
  Building2,
  ClipboardCheck,
  Users,
  ShieldCheck,
  FileWarning,
  Mailbox,
  Wallet,
  ReceiptText,
} from "lucide-react";

/**
 * Admin shell — gated to role=admin. Provides the editorial header
 * ("Batta · Admin") + a scroll-snapped chip nav so all six admin
 * surfaces are reachable in one swipe on a phone.
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

  const NAV = [
    { href: "/admin", label: "Overview", Icon: LayoutDashboard },
    { href: "/admin/properties", label: "Properties", Icon: Building2 },
    { href: "/admin/kyc-queue", label: "KYC queue", Icon: ShieldCheck },
    { href: "/admin/payments", label: "Payments", Icon: ReceiptText },
    { href: "/admin/payouts", label: "Payouts", Icon: Wallet },
    { href: "/admin/inspectors", label: "Inspectors", Icon: ClipboardCheck },
    { href: "/admin/users", label: "Users", Icon: Users },
    { href: "/admin/fraud", label: "Fraud", Icon: FileWarning },
    { href: "/admin/waitlist", label: "Waitlist", Icon: Mailbox },
  ] as const;

  return (
    // No min-h-screen — MobileShell already reserves space for the
    // top + bottom bars; a 100vh wrapper would push admin content
    // under the fixed bottom tab bar on mobile.
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

      {/* Chip nav — scroll-snap horizontal on phones, wraps on desktop. */}
      <nav className="snap-rail hide-scrollbar -mx-4 mt-4 mb-5 flex gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
        {NAV.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="tap-target inline-flex shrink-0 snap-start items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-foreground transition hover:border-gold/40 hover:text-gold-bright active:scale-[0.97]"
          >
            <Icon className="size-3.5" strokeWidth={2} />
            {label}
          </Link>
        ))}
      </nav>

      <main>{children}</main>
    </div>
  );
}
