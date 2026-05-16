"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { MailCheck } from "lucide-react";

// Signup is intentionally identity-only. Role elevation (agency, bank,
// bailiff, inspector, admin) happens via dedicated admin-reviewed flows
// after signup — never client-supplied. The DB's _on_auth_user_created
// trigger ignores any client-set role and pins new profiles to
// 'individual' regardless.
export function SignupForm() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  // When the project requires email confirmation, we land here on success
  // instead of bouncing to /login (audit #7) so the user actually knows
  // a confirmation email is on the way.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Only stash the safe display fields. The trigger reads these
        // and ignores any other key (including a hypothetical `role`).
        options: { data: { full_name: fullName, phone } },
      });
      if (error) {
        setError(error.message);
        return;
      }
      if (data.user && !data.user.email_confirmed_at) {
        setPendingEmail(email);
        return;
      }
      router.replace("/kyc");
      router.refresh();
    });
  }

  if (pendingEmail) {
    // Best-effort "open inbox" link: only the major web mailers map
    // cleanly to a URL. Users on Outlook desktop / Apple Mail just see
    // the back-to-login button.
    const domain = pendingEmail.split("@")[1] ?? "";
    const inboxUrl =
      domain === "gmail.com" ? "https://mail.google.com" :
      domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com"
        ? "https://outlook.live.com" :
      domain === "yahoo.com" || domain === "yahoo.fr"
        ? "https://mail.yahoo.com" :
      null;
    return (
      <div className="batta-frame-gold relative p-6 text-center">
        <div className="relative">
          <span className="batta-monogram batta-monogram-filled mx-auto mb-3 size-12 text-[18px]">
            <MailCheck className="size-5" strokeWidth={1.75} />
          </span>
          <h2 className="batta-serif text-[18px] font-semibold text-batta-cream">{t("signup.checkEmailTitle")}</h2>
          <p className="mt-2 text-sm text-batta-cream/75">
            {t("signup.checkEmailBody", { email: pendingEmail })}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {inboxUrl && (
              <a
                href={inboxUrl} target="_blank" rel="noopener noreferrer"
                className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13px]"
              >
                {t("signup.openInbox")}
              </a>
            )}
            <Link
              href="/login"
              className="batta-btn-ghost-gold tap-target w-full px-5 py-3 text-[13px]"
            >
              {t("signup.backToLogin")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Full name" value={fullName} onChange={setFullName} required />
      <Field label="Email" type="email" value={email} onChange={setEmail} required />
      <Field label="Phone" type="tel" value={phone} onChange={setPhone} />
      <Field
        label="Password (min 8)"
        type="password"
        value={password}
        onChange={setPassword}
        required
        minLength={8}
      />
      {error && (
        <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? t("common.loading") : t("nav.signup")}
      </button>
      <p className="text-center text-[11px] text-batta-muted">
        Need a partner / inspector account? Sign up here first, then apply from{" "}
        <span className="text-batta-cream">Account</span>.
      </p>
    </form>
  );
}

function Field({
  label, type = "text", value, onChange, required, minLength,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="batta-eyebrow text-[10px]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        minLength={minLength}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </label>
  );
}
