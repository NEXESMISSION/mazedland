import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { formatTND } from "@/lib/utils";
import { membershipsOf } from "@/lib/pro/shops";
import { BadgeCheck, Check, LayoutGrid, Store, Users, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("pro.landing");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

type Plan = { slug: string; name_fr: string; name_ar: string | null; description: string | null; description_ar: string | null; price: number | string; listing_quota: number };

/**
 * Mazed Immo Pro (cahier global V1 §03): what a shop gives a professional,
 * the three plans with their price and room, and the way in — open a shop
 * with the account you already have, or go to the one you run.
 */
export default async function ProLandingPage() {
  const locale = await getLocale();
  const t = await getTranslations("pro.landing");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const admin = getServiceSupabase();

  const [{ data: planRows }, memberships] = await Promise.all([
    (admin ?? supabase)
      .from("products")
      .select("slug, name_fr, name_ar, description, description_ar, price, listing_quota")
      .eq("kind", "subscription")
      .eq("is_active", true)
      .order("price"),
    user && admin ? membershipsOf(admin, user.id) : Promise.resolve([]),
  ]);
  const plans = (planRows ?? []) as Plan[];
  const hasShop = memberships.length > 0;
  const cta = hasShop ? "/pro/dashboard" : user ? "/pro/creer" : `/login?next=${encodeURIComponent(`/${locale}/pro/creer`)}`;

  const benefits = [
    { Icon: Store, key: "shop" },
    { Icon: LayoutGrid, key: "marketplace" },
    { Icon: Users, key: "team" },
    { Icon: Sparkles, key: "matches" },
  ] as const;

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 lg:py-14">
      <section className="text-center">
        <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-gold">Mazed Immo Pro</p>
        <h1 className="mx-auto mt-2 max-w-2xl text-[28px] font-extrabold leading-tight tracking-tight lg:text-[40px]">{t("title")}</h1>
        <p className="mx-auto mt-3 max-w-xl text-[14px] leading-relaxed text-muted lg:text-[15px]">{t("subtitle")}</p>
        <Link href={cta as never} className="mazed-btn-luxe tap-target mt-6 inline-flex h-12 items-center px-7 text-[14px]">
          {t(hasShop ? "ctaDashboard" : "ctaCreate")}
        </Link>
      </section>

      <section className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {benefits.map(({ Icon, key }) => (
          <div key={key} className="rounded-2xl border border-border bg-surface p-4">
            <Icon className="size-5 text-gold" />
            <p className="mt-2 text-[14px] font-extrabold text-foreground">{t(`benefits.${key}.title`)}</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{t(`benefits.${key}.body`)}</p>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <h2 className="text-center text-[20px] font-extrabold tracking-tight lg:text-[24px]">{t("plansTitle")}</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {plans.map((p, i) => {
            const featured = i === 1;
            return (
              <div
                key={p.slug}
                className={`flex flex-col rounded-3xl border p-5 ${featured ? "border-gold bg-gold-faint shadow-[0_18px_40px_-28px_rgba(0,0,0,0.5)]" : "border-border bg-surface"}`}
              >
                <p className="text-[15px] font-extrabold text-foreground">{locale === "ar" && p.name_ar ? p.name_ar : p.name_fr}</p>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="mazed-tabular text-[32px] font-extrabold text-foreground">{formatTND(Number(p.price), locale)}</span>
                  <span className="text-[13px] text-muted">{t("perMonth")}</span>
                </p>
                <p className="mt-1 text-[13px] font-bold text-gold">{t("quota", { count: p.listing_quota })}</p>
                <p className="mt-3 flex-1 text-[12.5px] leading-relaxed text-muted" dir="auto">
                  {locale === "ar" && p.description_ar ? p.description_ar : p.description}
                </p>
                <ul className="mt-4 space-y-1.5 text-[12.5px] text-foreground">
                  {(["shopPage", "inCatalogue", "noCommission"] as const).map((k) => (
                    <li key={k} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-3.5 shrink-0 text-gold" /> {t(`included.${k}`)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mx-auto mt-5 flex max-w-2xl items-start justify-center gap-2 text-center text-[12px] leading-relaxed text-muted">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" /> {t("verifiedNote")}
        </p>
      </section>
    </main>
  );
}
