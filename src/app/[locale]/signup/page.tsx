import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { SignupForm } from "@/components/auth/SignupForm";
import { AuthHeroPanel } from "@/components/auth/AuthHeroPanel";
import { Link } from "@/i18n/navigation";

/**
 * Signup surface.
 *   - Mobile (< lg): the original centered card, preserved verbatim.
 *   - Desktop (lg+): a split screen — a property-photo hero with floating
 *     trust cards on the left, the create-account card on the right.
 */
export default async function SignupPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — unchanged centered card ── */}
      <div className="lg:hidden mx-auto flex min-h-[calc(100dvh-9rem)] max-w-[var(--max-w)] flex-col items-center justify-center px-6 py-6">
        <div className="relative w-full max-w-sm">
          <div
            aria-hidden
            className="mazed-gradient-blob mazed-gradient-blob-lg absolute -left-1/3 -top-1/4 -z-10 opacity-20"
          />

          <div className="relative overflow-hidden rounded-3xl bg-surface ring-1 ring-border shadow-[var(--shadow-md)]">
            <div aria-hidden className="mazed-gradient-gold h-[2px] w-full" />

            <div className="p-7 sm:p-8">
              <div className="flex flex-col items-center text-center">
                <Image
                  src="/logo.webp"
                  alt={t("brand.name")}
                  width={357}
                  height={480}
                  sizes="60px"
                  loading="eager"
                  fetchPriority="high"
                  className="h-20 w-auto"
                />
                <h1
                  className={`mt-5 text-[24px] font-extrabold leading-[1.1] tracking-tight ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  <span className="gradient-gold-text">{t("nav.signup")}</span>
                </h1>
              </div>

              <div className="mt-7">
                <SignupForm />
              </div>
            </div>

            <div className="border-t border-border bg-surface-2 px-7 py-4 text-center sm:px-8">
              <p className="text-[12.5px] text-muted">
                Déjà inscrit ?{" "}
                <Link
                  href="/login"
                  className="font-bold text-foreground transition hover:text-gold-bright"
                >
                  {t("nav.login")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── DESKTOP (lg+) — one-screen split: hero + create-account card ── */}
      <div className="hidden h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[1.05fr_0.95fr]">
        <AuthHeroPanel />

        <div className="relative flex h-[100dvh] items-center justify-center overflow-y-auto bg-surface-2 px-8 py-10">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-surface p-8 shadow-[0_36px_90px_-34px_rgba(15,23,42,0.4)] ring-1 ring-border">
            <div aria-hidden className="mazed-gradient-gold absolute inset-x-0 top-0 h-[3px]" />

            <div className="flex flex-col items-center text-center">
              {/* The mark itself, not a generic house glyph in a gold tile.
                  The tile was standing in for a logo the product did not have
                  a usable file of; it does now. */}
              <Image
                src="/logo.webp"
                alt=""
                width={357}
                height={480}
                sizes="60px"
                loading="eager"
                fetchPriority="high"
                className="h-20 w-auto"
              />
              <h1
                className={`mt-5 text-[28px] font-extrabold leading-[1.1] tracking-tight ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                <span className="gradient-gold-text">{t("nav.signup")}</span>
              </h1>
            </div>

            <div className="mt-8">
              <SignupForm />
            </div>

            <p className="mt-6 text-center text-[13px] text-muted">
              Déjà inscrit ?{" "}
              <Link
                href="/login"
                className="font-bold text-foreground transition hover:text-gold-bright"
              >
                {t("nav.login")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
