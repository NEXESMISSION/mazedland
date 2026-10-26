import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { SmsNotificationsToggle } from "@/components/account/SmsNotificationsToggle";
import { DeleteAccountButton } from "@/components/account/DeleteAccountButton";
import { Ltr } from "@/components/ui/Ltr";
import { BellRing, EyeOff, Phone, ShieldCheck } from "lucide-react";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

/**
 * Paramètres — one account for every role (cahier des charges §11): the same
 * person sells, rents out, buys and looks for a rental from here. The page
 * holds what is theirs to set — name and governorate, notifications — and
 * says plainly what the site shows of them and what it never does, with the
 * way out (deleting the account) at the end.
 */
export default async function AccountSettingsPage() {
  const locale = await getLocale();
  const t = await getTranslations("accountSettings");
  const tAccount = await getTranslations("accountPage");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account/settings`)}`);

  const db = getServiceSupabase() ?? supabase;
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, phone, governorate, sms_notifications_enabled")
    .eq("id", user!.id)
    .maybeSingle();
  // No governorate on the profile: the one of the latest annonce is offered
  // in one tap — most people sell where they live.
  const { data: latest } = profile?.governorate
    ? { data: null }
    : await db.from("listings").select("governorate").eq("seller_id", user!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

  // What the site shows of a person and what it never does — true today, not
  // promises: each line is a behaviour the code already has.
  const privacy = [
    { Icon: Phone, text: t("privacyPhone") },
    { Icon: EyeOff, text: t("privacyRequests") },
    { Icon: ShieldCheck, text: t("privacyReports") },
  ];

  return (
    <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 lg:py-10">
      <div>
        <h1 className="text-[24px] font-extrabold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-[13px] text-muted">{t("subtitle")}</p>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-[15px] font-extrabold text-foreground">{t("profileTitle")}</h2>
        {profile?.phone && (
          <p className="mt-1 text-[12.5px] text-muted">
            {t("phoneLine")} <Ltr className="font-semibold text-foreground">{profile.phone as string}</Ltr>
          </p>
        )}
        <div className="mt-4">
          <ProfileForm
            initialName={(profile?.full_name as string | null) ?? ""}
            initialGovernorate={(profile?.governorate as string | null) ?? ""}
            suggestedGovernorate={(latest?.governorate as string | null | undefined) ?? null}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-surface">
        <h2 className="px-4 pt-4 text-[15px] font-extrabold text-foreground">{t("notificationsTitle")}</h2>
        <SmsNotificationsToggle initial={(profile?.sms_notifications_enabled as boolean | null) ?? true} />
        <Link
          href={"/account/requests" as never}
          className="flex items-center gap-2 border-t border-border px-4 py-3 text-[12.5px] font-bold text-gold hover:underline"
        >
          <BellRing className="size-4" /> {t("requestAlerts")}
        </Link>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-[15px] font-extrabold text-foreground">{t("privacyTitle")}</h2>
        <ul className="mt-3 space-y-2.5">
          {privacy.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-foreground">
              <Icon className="mt-0.5 size-4 shrink-0 text-gold" />
              {text}
            </li>
          ))}
        </ul>
        <Link href={"/privacy" as never} className="mt-3 inline-flex text-[12.5px] font-bold text-gold hover:underline">
          {t("privacyPolicy")}
        </Link>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-[15px] font-extrabold text-foreground">{t("deleteTitle")}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("deleteBody")}</p>
        <div className="mt-3 max-w-sm">
          <DeleteAccountButton label={tAccount("deleteAccount")} />
        </div>
      </section>
    </main>
  );
}
