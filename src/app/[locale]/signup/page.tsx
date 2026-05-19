import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { SignupForm } from "@/components/auth/SignupForm";
import { Link } from "@/i18n/navigation";

/**
 * Signup surface — centered card with a top gold accent, brand mark,
 * headline + subtitle, the form, and a footer sentence linking to
 * login. Card has a hairline border + soft shadow so the form feels
 * grounded instead of floating in empty whitespace.
 */
export default async function SignupPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-[var(--max-w)] flex-col items-center justify-center px-6 py-6">
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
                <span className="gradient-gold-text">{t("nav.signup")}</span>
              </h1>
              <p className="mt-2 text-[12.5px] text-muted">
                Quelques secondes pour commencer à enchérir.
              </p>
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
  );
}
