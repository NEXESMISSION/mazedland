import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { AuthHeroPanel } from "@/components/auth/AuthHeroPanel";
import { Link } from "@/i18n/navigation";

/**
 * "Forgot password" page — collects the user's email and asks Supabase to send
 * a recovery magic link (→ /reset-password?type=recovery).
 *   - Mobile (< lg): centered card.
 *   - Desktop (lg+): the same split-screen hero + card as login/signup, so the
 *     whole auth quartet is visually coherent (previously this collapsed to a
 *     lonely 384px card on a vast empty desktop field).
 */
export default async function ForgotPasswordPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  const Card = (
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
            <span className="gradient-gold-text">Mot de passe oublié</span>
          </h1>
          <p className="mt-2 text-[12.5px] text-muted">
            Entrez l&apos;adresse de votre compte — nous vous enverrons un lien pour le réinitialiser.
          </p>
        </div>

        <div className="mt-7">
          <ForgotPasswordForm />
        </div>
      </div>

      <div className="border-t border-border bg-surface-2 px-7 py-4 text-center sm:px-8">
        <p className="text-[12.5px] text-muted">
          Vous vous en souvenez ?{" "}
          <Link
            href="/login"
            className="font-bold text-foreground transition hover:text-gold-bright"
          >
            Se connecter
          </Link>
        </p>
      </div>
    </div>
  );

  return (
    <>
      {/* ── MOBILE / tablet (< lg) — centered card ── */}
      <div className="lg:hidden mx-auto flex min-h-[calc(100dvh-9rem)] max-w-[var(--max-w)] flex-col items-center justify-center px-6">
        <div className="relative w-full max-w-sm">
          <div
            aria-hidden
            className="batta-gradient-blob batta-gradient-blob-lg absolute -left-1/3 -top-1/4 -z-10 opacity-20"
          />
          {Card}
        </div>
      </div>

      {/* ── DESKTOP (lg+) — split: hero + card ── */}
      <div className="hidden h-[100dvh] overflow-hidden lg:grid lg:grid-cols-[1.05fr_0.95fr]">
        <AuthHeroPanel />
        <div className="relative flex h-[100dvh] items-center justify-center overflow-y-auto bg-surface-2 px-8 py-10">
          <div className="w-full max-w-md">{Card}</div>
        </div>
      </div>
    </>
  );
}
