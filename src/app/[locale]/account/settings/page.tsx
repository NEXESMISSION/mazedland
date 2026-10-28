import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { SmsNotificationsToggle } from "@/components/account/SmsNotificationsToggle";
import { DeleteAccountButton } from "@/components/account/DeleteAccountButton";
import { Ltr } from "@/components/ui/Ltr";
import { BellRing, Download, EyeOff, Phone, ShieldCheck } from "lucide-react";
import { getSettings } from "@/lib/settings/server";
import { consentHistory } from "@/lib/consents/server";
import { CONSENT_KINDS, currentConsents } from "@/lib/consents/model";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

/**
 * Paramètres — one account for every role (cahier des charges §11): the same
 * person sells, rents out, buys and looks for a rental from here. The page
 * holds what is theirs to set — name and governorate, notifications — and
 * says plainly what the site shows of them and what it never does, what they
 * accepted and how long each trace is kept (« Mes données », with the
 * download of everything), and the way out (deleting the account) at the end.
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
  const [settings, history] = await Promise.all([getSettings(), consentHistory(db, user!.id)]);
  const consents = currentConsents(history);
  const day = new Intl.DateTimeFormat(locale === "ar" ? "ar-TN" : "fr-TN", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Tunis" });
  const kept = (days: number) => (days === 0 ? t("keptForever") : t("keptDays", { days }));
  // Read by the nightly jobs (0182) from the same settings.
  const retention = [
    { label: t("retentionIp"), value: kept(settings.privacy_anonymize_days) },
    { label: t("retentionPageViews"), value: kept(settings.privacy_page_views_days) },
    { label: t("retentionActivity"), value: kept(settings.privacy_activity_days) },
    { label: t("retentionNotifications"), value: kept(settings.privacy_notifications_days) },
    { label: t("retentionTraces"), value: kept(settings.privacy_traces_days) },
    { label: t("retentionPayments"), value: t("retentionPaymentsValue") },
  ];

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
        <h2 className="text-[15px] font-extrabold text-foreground">{t("dataTitle")}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t("dataBody")}</p>

        <h3 className="mt-4 text-[12px] font-bold uppercase tracking-wide text-subtle">{t("consentsTitle")}</h3>
        <ul className="mt-2 divide-y divide-border">
          {CONSENT_KINDS.map((kind) => {
            const c = consents[kind];
            return (
              <li key={kind} className="flex items-baseline justify-between gap-3 py-2 text-[12.5px]">
                <span className="shrink-0 font-semibold text-foreground">{t(`consent_${kind}`)}</span>
                <span className="text-end text-muted">
                  {!c
                    ? t("consentNone")
                    : t(c.granted ? "consentGiven" : "consentRefused", {
                        date: day.format(new Date(c.created_at)),
                        version: `\u2066${c.version}\u2069`,
                      })}
                </span>
              </li>
            );
          })}
        </ul>

        <h3 className="mt-4 text-[12px] font-bold uppercase tracking-wide text-subtle">{t("retentionTitle")}</h3>
        <ul className="mt-2 divide-y divide-border">
          {retention.map(({ label, value }) => (
            <li key={label} className="flex items-baseline justify-between gap-3 py-2 text-[12.5px]">
              <span className="text-foreground">{label}</span>
              <span className="shrink-0 font-semibold text-foreground">{value}</span>
            </li>
          ))}
        </ul>

        <a
          href="/api/account/export"
          download
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-[12.5px] font-bold text-gold hover:bg-[var(--surface-2)]"
        >
          <Download className="size-4" /> {t("dataDownload")}
        </a>
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
