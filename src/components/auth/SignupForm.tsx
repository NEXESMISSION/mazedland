"use client";

import { useEffect, useState, useTransition } from "react";
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
    // Phone is optional, but if present we want a sane Tunisia format
    // so a downstream SMS provider doesn't bounce. Accept the local
    // 8-digit form (12345678) or the E.164 form (+21612345678); we
    // normalize to E.164 before sending.
    let normalizedPhone: string | null = null;
    if (phone.trim()) {
      const digits = phone.replace(/[^\d+]/g, "");
      if (/^\+216\d{8}$/.test(digits)) {
        normalizedPhone = digits;
      } else if (/^00216\d{8}$/.test(digits)) {
        normalizedPhone = `+${digits.slice(2)}`;
      } else if (/^\d{8}$/.test(digits)) {
        normalizedPhone = `+216${digits}`;
      } else {
        setError(
          "Numéro de téléphone invalide — utilisez 12345678 ou +21612345678.",
        );
        return;
      }
    }
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // Only stash the safe display fields. The trigger reads these
        // and ignores any other key (including a hypothetical `role`).
        options: { data: { full_name: fullName, phone: normalizedPhone } },
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
    return (
      <ConfirmationSent
        email={pendingEmail}
        backToLoginLabel={t("signup.backToLogin")}
        openInboxLabel={t("signup.openInbox")}
        title={t("signup.checkEmailTitle")}
        body={t("signup.checkEmailBody", { email: pendingEmail })}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Full name" value={fullName} onChange={setFullName} required />
      <Field label="Email" type="email" value={email} onChange={setEmail} required />
      <Field
        label="Téléphone (optionnel)"
        type="tel"
        value={phone}
        onChange={setPhone}
        placeholder="12345678"
      />
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
  label, type = "text", value, onChange, required, minLength, placeholder,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="batta-eyebrow text-[10px]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </label>
  );
}

/**
 * "Check your email" card with a resend button. We rate-limit on the
 * client (30s between attempts) to avoid hammering Supabase's resend
 * endpoint, which itself rate-limits per-user.
 */
function ConfirmationSent({
  email, title, body, openInboxLabel, backToLoginLabel,
}: {
  email: string;
  title: string;
  body: string;
  openInboxLabel: string;
  backToLoginLabel: string;
}) {
  const [resentAt, setResentAt] = useState<number | null>(null);
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Tick the cooldown counter once per second while it's > 0 so the
  // button label updates live.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const domain = email.split("@")[1] ?? "";
  const inboxUrl =
    domain === "gmail.com" ? "https://mail.google.com" :
    domain === "outlook.com" || domain === "hotmail.com" || domain === "live.com"
      ? "https://outlook.live.com" :
    domain === "yahoo.com" || domain === "yahoo.fr"
      ? "https://mail.yahoo.com" :
    null;

  async function resend() {
    if (cooldown > 0 || resending) return;
    setResendError(null);
    setResending(true);
    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.resend({ type: "signup", email });
      if (error) {
        setResendError(error.message);
        return;
      }
      setResentAt(Date.now());
      setCooldown(30);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="batta-frame-gold relative p-6 text-center">
      <div className="relative">
        <span className="batta-monogram batta-monogram-filled mx-auto mb-3 size-12 text-[18px]">
          <MailCheck className="size-5" strokeWidth={1.75} />
        </span>
        <h2 className="batta-serif text-[18px] font-semibold text-batta-cream">{title}</h2>
        <p className="mt-2 text-sm text-batta-cream/75">{body}</p>
        {resentAt && !resendError && (
          <p className="batta-tone-ok mt-3 rounded-lg px-3 py-1.5 text-[11px] inline-block">
            Email renvoyé.
          </p>
        )}
        {resendError && (
          <p className="batta-tone-bad mt-3 rounded-lg px-3 py-1.5 text-[11px]">
            {resendError}
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          {inboxUrl && (
            <a
              href={inboxUrl} target="_blank" rel="noopener noreferrer"
              className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13px]"
            >
              {openInboxLabel}
            </a>
          )}
          <button
            type="button"
            onClick={resend}
            disabled={cooldown > 0 || resending}
            className="batta-btn-ghost-gold tap-target w-full px-5 py-3 text-[13px] disabled:opacity-50"
          >
            {resending
              ? "Envoi…"
              : cooldown > 0
                ? `Renvoyer (${cooldown}s)`
                : "Renvoyer l'email"}
          </button>
          <Link
            href="/login"
            className="text-[12px] text-batta-cream/70 hover:text-gold-bright"
          >
            {backToLoginLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}
