import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthHeroPanel } from "@/components/auth/AuthHeroPanel";
import { Link } from "@/i18n/navigation";
import { Home } from "lucide-react";

/**
 * Login surface.
 *   - Mobile (< lg): the original centered card, preserved verbatim.
 *   - Desktop (lg+): a split screen — a property-photo hero with floating
 *     trust cards on the left, the sign-in card on the right.
 */
export default async function LoginPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — unchanged centered card ── */}
      <div className="lg:hidden mx-auto flex min-h-[calc(100dvh-9rem)] max-w-[var(--max-w)] flex-col items-center justify-center px-6">
        <div className="relative w-full max-w-sm">
          <div
            aria-hidden
            className="batta-gradient-blob batta-gradient-blob-lg absolute -left-1/3 -top-1/4 -z-10 opacity-20"
          />

          <div className="relative overflow-hidden rounded-3xl bg-surface ring-1 ring-border shadow-[var(--shadow-md)]">
            <div aria-hidden className="batta-gradient-gold h-[2px] w-full" />

            <div className="p-7 sm:p-8">
              <div className="flex flex-col items-center text-center">
                <Image
                  src="/logo-square.png"
                  alt={t("brand.name")}
                  width={96}
                  height={96}
                  priority
                  className="h-20 w-auto"
                />
                <h1
                  className={`mt-5 text-[24px] font-extrabold leading-[1.1] tracking-tight ${
                    isRTL ? "font-arabic" : ""
                  }`}
                >
                  <span className="gradient-gold-text">{t("nav.login")}</span>
                </h1>
              </div>

              <div className="mt-7">
                <LoginForm />
              </div>
              <p className="mt-4 text-center text-[12.5px]">
                <Link
                  href="/forgot-password"
                  className="font-semibold text-muted transition hover:text-gold-bright"
                >
                  Mot de passe oublié ?
                </Link>
              </p>
            </div>

            <div className="border-t border-border bg-surface-2 px-7 py-4 text-center sm:px-8">
              <p className="text-[12.5px] text-muted">
                Pas encore de compte ?{" "}
                <Link
                  href="/signup"
                  className="font-bold text-foreground transition hover:text-gold-bright"
                >
                  {t("nav.signup")}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── DESKTOP (lg+) — one-screen split: hero + sign-in card ── */}
      <div className="hidden h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[1.05fr_0.95fr]">
        <AuthHeroPanel />

        <div className="relative flex h-[100dvh] items-center justify-center overflow-y-auto bg-surface-2 px-8 py-10">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl bg-surface p-8 shadow-[0_36px_90px_-34px_rgba(15,23,42,0.4)] ring-1 ring-border">
            <div aria-hidden className="batta-gradient-gold absolute inset-x-0 top-0 h-[3px]" />

            <div className="flex flex-col items-center text-center">
              <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--gold)] to-[var(--gold-bright)] text-white shadow-[0_14px_34px_-12px_rgba(30,58,138,0.65)]">
                <Home className="size-8" strokeWidth={2} />
              </span>
              <h1
                className={`mt-5 text-[28px] font-extrabold leading-[1.1] tracking-tight ${
                  isRTL ? "font-arabic" : ""
                }`}
              >
                Bienvenue sur <span className="gradient-gold-text">{t("brand.name")}</span>
              </h1>
            </div>

            <div className="mt-8">
              <LoginForm />
            </div>
            <p className="mt-4 text-center text-[13px]">
              <Link
                href="/forgot-password"
                className="font-semibold text-muted transition hover:text-gold-bright"
              >
                Mot de passe oublié ?
              </Link>
            </p>

            <p className="mt-6 text-center text-[13px] text-muted">
              Pas encore de compte ?{" "}
              <Link
                href="/signup"
                className="font-bold text-foreground transition hover:text-gold-bright"
              >
                {t("nav.signup")}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
