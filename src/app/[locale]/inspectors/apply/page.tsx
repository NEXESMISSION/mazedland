import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { InspectorApplyForm } from "@/components/inspector/InspectorApplyForm";
import { getLocale, getTranslations } from "next-intl/server";

// Per-user, auth-gated — never static (env-less prerender would throw + fail the build).
export const dynamic = "force-dynamic";

export default async function InspectorApply({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await getTranslations();
  const currentLocale = await getLocale();
  const isRTL = currentLocale === "ar";

  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });
  } catch {
    // env not configured — render the form; the client SDK will surface
    // the sign-in requirement on submit.
  }

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
      <div className="batta-frame-gold relative p-7">
        <div className="relative">
          <span className="batta-eyebrow">Inspector accreditation</span>
          <h1
            className={`mt-2 text-[26px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            <span className="gradient-gold-text">Apply to join the network</span>
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            We onboard 8 inspectors per quarter across Tunisia. Review takes
            5–10 working days.
          </p>
          <div className="mt-6">
            <InspectorApplyForm />
          </div>
        </div>
      </div>
    </div>
  );
}
