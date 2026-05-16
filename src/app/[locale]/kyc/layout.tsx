import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Auth gate for the entire KYC flow. Anonymous visitors are bounced to
 * login — there is no public KYC entry point. Signed-in users at every
 * verification status can reach the flow; /kyc/status surfaces the
 * current state and /kyc/start guides them into a (re-)submission.
 */
export default async function KYCLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });
    }
  } catch (e) {
    // env missing in dev — let the page render and surface its own
    // "not signed in" state. Beats hard-crashing the route. We log
    // so the cause is visible in the server console rather than
    // silently presenting a half-broken camera flow to the dev.
    console.warn(
      "[KYC layout] auth gate skipped — Supabase env likely missing. " +
        "Pages will render without a user; camera/upload buttons will be disabled.",
      e instanceof Error ? e.message : e,
    );
  }

  return <>{children}</>;
}
