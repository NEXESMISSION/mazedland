"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { stripLocalePrefix } from "@/i18n/routing";

/**
 * Honor a `?next=/some/path` query param so users coming from a "Sign in
 * to bid" link land back on the auction they were trying to interact
 * with — not on the home page (audit #6).
 *
 * The next-intl router prepends the active locale itself, so we strip
 * the redundant prefix from `next` before pushing to avoid producing
 * `/ar/ar/auctions/...`.
 */
export function LoginForm() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const next = rawNext && rawNext.startsWith("/") ? stripLocalePrefix(rawNext) : "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      // Hard navigation rather than router.replace + router.refresh.
      // The Supabase auth cookie is written synchronously by @supabase/ssr,
      // but the Next router's soft refresh sometimes prefetches the
      // destination page before the cookie has propagated to the document,
      // leaving the server render anonymous and the account page back on
      // the guest banner. A full reload guarantees the new cookie is
      // attached to the next request.
      const destination = next === "/" ? `/${locale}` : `/${locale}${next}`;
      window.location.assign(destination);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" type="email" value={email} onChange={setEmail} required />
      <Field label="Password" type="password" value={password} onChange={setPassword} required />
      {error && <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? t("common.loading") : t("nav.login")}
      </button>
    </form>
  );
}

function Field({
  label, type, value, onChange, required,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="batta-eyebrow text-[10px]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </label>
  );
}
