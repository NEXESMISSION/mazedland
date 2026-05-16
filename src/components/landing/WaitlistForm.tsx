"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle2 } from "lucide-react";

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistForm() {
  const t = useTranslations("landing");
  const locale = useLocale();
  const isRTL = locale === "ar";
  const [status, setStatus] = useState<Status>("idle");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, phone, locale }),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("success");
      setEmail("");
      setPhone("");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="batta-tone-ok rounded-xl px-4 py-6">
        <CheckCircle2 className="size-7" strokeWidth={2.2} />
        <p className="mt-2 font-semibold">
          {locale === "ar"
            ? "تم تسجيلك بنجاح! ستصلك تفاصيل الإطلاق على بريدك."
            : locale === "fr"
              ? "Inscription confirmée. Nous vous contacterons au lancement."
              : "You're in! We'll reach out at launch."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1.3fr_1fr_auto]">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        className="rounded-full border border-gold/25 bg-surface-2 px-5 py-3 text-foreground placeholder:text-muted focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        dir={isRTL ? "rtl" : "ltr"}
      />
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={t("phonePlaceholder")}
        className="rounded-full border border-gold/25 bg-surface-2 px-5 py-3 text-foreground placeholder:text-muted focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/30"
        dir={isRTL ? "rtl" : "ltr"}
      />
      <button
        type="submit"
        disabled={status === "submitting"}
        className="batta-btn-luxe tap-target px-6 py-3 text-[13px] disabled:opacity-50"
      >
        {status === "submitting" ? "…" : t("joinWaitlist")}
      </button>
      {status === "error" && (
        <p className="batta-tone-bad sm:col-span-3 rounded-lg px-3 py-2 text-sm">
          {locale === "ar"
            ? "حدث خطأ. حاول مرة أخرى."
            : locale === "fr"
              ? "Une erreur est survenue. Réessayez."
              : "Something went wrong. Try again."}
        </p>
      )}
    </form>
  );
}
