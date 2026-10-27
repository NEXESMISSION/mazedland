import type { Metadata } from "next";
import { pageAlternates } from "@/lib/seo";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LegalPage } from "@/components/legal/LegalPage";
import { Ltr } from "@/components/ui/Ltr";
import { Mail, Phone, MapPin, Clock, MessageCircle } from "lucide-react";
import { whatsappHref } from "@/lib/contact";
import { getSettings } from "@/lib/settings/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return { title: t("metaTitle"), alternates: pageAlternates(locale, "/contact") };
}

// Prerendered and served from the edge CDN; the layout's `revalidate` rebuilds
// it within a minute of a change in /admin/settings → Contact.
export const dynamic = "force-static";

/** tel: wants digits and a leading +, not the spaces that make it readable. */
const telHref = (v: string) => `tel:${v.replace(/[^\d+]/g, "")}`;

/**
 * Labels are message keys under `contact`, translated at render. A row's
 * value is either a setting (`value`, shown as-is and kept left-to-right) or
 * a message key (`valueKey`).
 */
type Item = {
  Icon: typeof Mail;
  labelKey: "whatsapp" | "email" | "phone" | "address" | "hours";
  /** A line under the value (« messages uniquement »). */
  noteKey?: "whatsappNote";
  external?: boolean;
  value?: string;
  valueKey?: "addressValue" | "hoursValue";
  href: string | null;
};

/**
 * Every channel is a setting (/admin/settings → Contact), and its row
 * DISAPPEARS when it is empty.
 *
 * The e-mail used to be a literal on the pre-rebrand domain, which the business
 * owned; the rebrand has no domain behind it yet, and an address that bounces
 * is worse than no address. The phone was a literal too — "+216 70 000 000",
 * which is not a number anyone answers. It sat on the page as the ONLY
 * actionable detail, presented exactly like a real one: a visitor with a
 * question about a payment dialled it and got nothing. With no channel left
 * the page says so, which is honest and is also hard to miss.
 *
 * The e-mail has a real mailbox behind it: contact@mazed.immo, the company's
 * own (Google Workspace, given by the owner on 2026-10-21), the setting's
 * default. The phone has none by default; NEXT_PUBLIC_CONTACT_PHONE, which
 * set it before the console did, still fills it while the setting is empty.
 *
 * WhatsApp comes first (src/lib/contact.ts): it is where the team answers.
 * Messages only — the row opens a chat, never a call. Its switch hides it.
 */
export default async function ContactPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Static rendering with next-intl: the page must set the locale itself
  // (Next can render it apart from the layout) before any translation call.
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  const s = await getSettings();
  const whatsapp = s.feature_whatsapp ? s.contact_whatsapp : "";
  const email = s.contact_email;
  const phone = s.contact_phone || process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim() || "";

  const items: Item[] = [
    ...(whatsapp
      ? [{ Icon: MessageCircle, labelKey: "whatsapp", value: whatsapp, href: whatsappHref(whatsapp), noteKey: "whatsappNote", external: true } satisfies Item]
      : []),
    ...(email ? [{ Icon: Mail, labelKey: "email", value: email, href: `mailto:${email}` } satisfies Item] : []),
    ...(phone ? [{ Icon: Phone, labelKey: "phone", value: phone, href: telHref(phone) } satisfies Item] : []),
    { Icon: MapPin, labelKey: "address", valueKey: "addressValue", href: null },
    { Icon: Clock, labelKey: "hours", valueKey: "hoursValue", href: null },
  ];
  const hasChannel = Boolean(whatsapp || email || phone);

  return (
    <LegalPage eyebrow={t("eyebrow")} title={t("title")}>
      <p className="text-[13.5px] leading-relaxed text-foreground/80">
        {t("intro")}
      </p>
      {!hasChannel && (
        <p className="mt-3 rounded-xl bg-surface-2 px-3.5 py-3 text-[12.5px] leading-relaxed text-muted ring-1 ring-border">
          {t("pending")}
        </p>
      )}
      <ul className="mt-5 space-y-2.5">
        {items.map((it) => {
          const inner = (
            <>
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-faint text-gold ring-1 ring-gold/30">
                <it.Icon className="size-4.5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted rtl:tracking-normal">
                  {t(it.labelKey)}
                </div>
                <div className="mt-0.5 text-[14px] font-bold text-foreground">
                  {it.valueKey ? t(it.valueKey) : <Ltr>{it.value}</Ltr>}
                </div>
                {it.noteKey && <div className="text-[11.5px] text-muted">{t(it.noteKey)}</div>}
              </div>
            </>
          );
          return (
            <li key={it.labelKey}>
              {it.href ? (
                <a
                  href={it.href}
                  {...(it.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border transition hover:ring-gold-soft/60"
                >
                  {inner}
                </a>
              ) : (
                <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3.5 ring-1 ring-border">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </LegalPage>
  );
}
