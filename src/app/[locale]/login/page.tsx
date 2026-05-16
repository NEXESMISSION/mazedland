import Image from "next/image";
import { getTranslations, getLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { Link } from "@/i18n/navigation";

export default async function LoginPage() {
  const t = await getTranslations();
  const locale = await getLocale();
  const isRTL = locale === "ar";

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
      <div className="batta-frame-gold relative p-7">
        <div className="relative">
          <div className="flex flex-col items-center text-center">
            <Image
              src="/logo-square.png"
              alt={t("brand.name")}
              width={64}
              height={64}
              priority
              className="h-16 w-16"
            />
            <span className="batta-eyebrow mt-3">Members · sign in</span>
            <h1
              className={`mt-2 text-[26px] font-extrabold leading-tight tracking-tight ${
                isRTL ? "font-arabic" : ""
              }`}
            >
              <span className="gradient-gold-text">{t("nav.login")}</span>
            </h1>
            <p className="mt-1.5 text-[12.5px] uppercase tracking-[0.16em] text-muted">
              {t("brand.slogan")}
            </p>
          </div>

          <div aria-hidden className="batta-hairline mt-6" />

          <div className="mt-6">
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-[12.5px] text-muted">
            <Link
              href="/signup"
              className="font-semibold text-foreground hover:text-gold-bright"
            >
              {t("nav.signup")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
