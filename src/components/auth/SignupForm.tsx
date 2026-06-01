"use client";

import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { MailCheck, Loader2 } from "lucide-react";
import { PhoneInput } from "./PhoneInput";
import { TUNISIAN_GOVERNORATES, normalizeE164, validatePhone } from "@/lib/tunisia";
import { Modal } from "@/components/ui/Modal";
import { TermsContent, PrivacyContent } from "@/components/legal/LegalContent";

// Signup is intentionally identity-only. Role elevation (agency, bank,
// bailiff, inspector, admin) happens via dedicated admin-reviewed flows
// after signup — never client-supplied. The DB's _on_auth_user_created
// trigger ignores any client-set role and pins new profiles to
// 'individual' regardless.
//
// Required fields (audit: we lost too many KYC-eligible users to optional
// phone + no ville on signup):
//   - full name
//   - email + password
//   - dial code + phone (split fields → composed to E.164 on submit)
//   - ville / gouvernorat (24-item native select)
//
// All four metadata keys (full_name, phone, governorate, language) are
// passed via `options.data` and picked up by `_on_auth_user_created`
// (migration 0045) when the auth.users row is inserted.
export function SignupForm() {
  const t = useTranslations();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [dialCode, setDialCode] = useState("+216");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [legalModal, setLegalModal] = useState<null | "terms" | "privacy">(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validatePhone(dialCode, phoneNumber);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    const normalizedPhone = normalizeE164(dialCode, phoneNumber);
    if (!normalizedPhone) {
      // normalizeE164 only returns null on degenerate input that
      // validatePhone already caught. Defensive fallback so a future
      // schema change in one helper can't ship a confusing form error.
      setError("Numéro invalide.");
      return;
    }
    if (!governorate) {
      setError("Sélectionnez votre gouvernorat pour continuer.");
      return;
    }
    if (!accepted) {
      setError("Veuillez accepter les conditions d'utilisation et la politique de confidentialité.");
      return;
    }
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone: normalizedPhone,
            governorate,
          },
        },
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
      <Field label="Nom complet" value={fullName} onChange={setFullName} required />
      <Field label="Email" type="email" value={email} onChange={setEmail} required />

      <label className="block">
        <span className="batta-eyebrow text-[10px]">Téléphone</span>
        <PhoneInput
          dialCode={dialCode}
          onDialCodeChange={setDialCode}
          number={phoneNumber}
          onNumberChange={setPhoneNumber}
          required
        />
      </label>

      <label className="block">
        <span className="batta-eyebrow text-[10px]">Gouvernorat</span>
        <select
          value={governorate}
          onChange={(e) => setGovernorate(e.target.value)}
          required
          className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        >
          <option value="" disabled className="bg-batta-surface-2">
            Choisir votre gouvernorat…
          </option>
          {TUNISIAN_GOVERNORATES.map((g) => (
            <option key={g} value={g} className="bg-batta-surface-2">
              {g}
            </option>
          ))}
        </select>
      </label>

      <Field
        label="Mot de passe (min 8)"
        type="password"
        value={password}
        onChange={setPassword}
        required
        minLength={8}
      />
      {/* Terms + privacy consent — required. The documents open in a modal
          so the user can read them without leaving signup. The legal links
          are NOT wrapped in the <label> (a label would steal their clicks and
          toggle the checkbox instead of opening the modal). */}
      <div className="flex items-start gap-2.5 text-[12px] leading-relaxed text-batta-cream/80">
        <input
          id="signup-accept"
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--gold)]"
        />
        <span>
          <label htmlFor="signup-accept" className="cursor-pointer">J&apos;accepte les</label>{" "}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setLegalModal("terms"); }}
            className="font-bold text-batta-cream underline transition hover:text-gold-bright"
          >
            conditions d&apos;utilisation
          </button>{" "}
          <label htmlFor="signup-accept" className="cursor-pointer">et la</label>{" "}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setLegalModal("privacy"); }}
            className="font-bold text-batta-cream underline transition hover:text-gold-bright"
          >
            politique de confidentialité
          </button>
          .
        </span>
      </div>

      {error && (
        <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>
      )}
      <button
        type="submit"
        disabled={isPending || !accepted}
        title={!accepted && !isPending ? "Acceptez les conditions d'utilisation" : undefined}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? (
          <><Loader2 className="inline size-4 animate-spin" /> Création du compte…</>
        ) : (
          t("nav.signup")
        )}
      </button>

      <Modal
        open={legalModal !== null}
        onClose={() => setLegalModal(null)}
        size="lg"
        title={legalModal === "privacy" ? "Politique de confidentialité" : "Conditions d'utilisation"}
      >
        {legalModal === "privacy" ? <PrivacyContent /> : <TermsContent />}
      </Modal>
      <p className="text-center text-[11px] text-batta-muted">
        Compte partenaire (agence, expert, banque) ? Créez un compte ici puis
        candidatez depuis <span className="text-batta-cream">Compte</span>.
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
