import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Locale = "ar" | "fr" | "en";

/**
 * KYC entry point. Routes to the right surface based on the user's
 * current verdict so we never bounce through /kyc/start only to be
 * re-redirected to /kyc/status by the middleware gate.
 *   verified / submitted / pending  →  /kyc/status
 *   none / rejected / anonymous     →  /kyc/start
 */
export default async function KYCIndex({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const loc = locale as Locale;

  try {
    const supabase = await getServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("kyc_status")
        .eq("id", user.id)
        .single();
      const s = profile?.kyc_status;
      if (s === "verified" || s === "submitted" || s === "pending") {
        redirect({ href: "/kyc/status", locale: loc });
      }
    }
  } catch {
    // Env missing in dev or transient supabase error — fall through to
    // /kyc/start which renders the public intro without a session.
  }

  redirect({ href: "/kyc/start", locale: loc });
}
