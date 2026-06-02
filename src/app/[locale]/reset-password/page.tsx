import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { AuthHeroPanel } from "@/components/auth/AuthHeroPanel";

/**
 * Landing page for the password-recovery magic link sent by Supabase. The URL
 * fragment carries a recovery token; Supabase JS creates a short-lived
 * recovery session so the user can call `auth.updateUser({ password })`.
 *
 *   - Mobile (< lg): centered card.
 *   - Desktop (lg+): the shared split-screen hero + card, matching the rest of
 *     the auth flow (no more lonely card on a vast empty desktop field).
 *
 * No "back to login" footer — the form's success state redirects to /login.
 */
export default async function ResetPasswordPage() {
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
            <span className="gradient-gold-text">Nouveau mot de passe</span>
          </h1>
          <p className="mt-2 text-[12.5px] text-muted">
            Choisissez un nouveau mot de passe pour votre compte.
          </p>
        </div>

        <div className="mt-7">
          <ResetPasswordForm />
        </div>
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
