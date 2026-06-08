"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { Loader2 } from "lucide-react";
import { stripLocalePrefix } from "@/i18n/routing";
import { PhoneInput } from "./PhoneInput";
import { normalizeE164, validatePhone } from "@/lib/tunisia";

type Mode = "email" | "phone";

/**
 * Honor a `?next=/some/path` query param so users coming from a "Sign in
 * to bid" link land back on the auction they were trying to interact
 * with — not on the home page (audit #6).
 *
 * The next-intl router prepends the active locale itself, so we strip
 * the redundant prefix from `next` before pushing to avoid producing
 * `/ar/ar/auctions/...`.
 */
/**
 * Reject anything that, despite starting with "/", could be parsed by
 * the browser as a foreign origin:
 *   - `//evil.com` and `/\evil.com` are protocol-relative (browser
 *     treats them as host).
 *   - URLs with embedded `:` (scheme), or already-absolute URLs.
 *   - `\` in any position (Windows-style separator confuses some
 *     normalizers).
 * The current code prepends `/${locale}` which neutralizes the obvious
 * cases, but we still defence-in-depth here so a future refactor doesn't
 * accidentally make this an open redirect.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.includes("\\")) return "/";
  // Bare scheme-relative or absolute URL via a creative encoding
  // (very rare, but cheap to block).
  if (/^\/+[a-z][a-z0-9+.-]*:/i.test(raw)) return "/";
  return raw;
}

export function LoginForm() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const safeNext = safeNextPath(rawNext);
  const next = safeNext === "/" ? "/" : stripLocalePrefix(safeNext);

  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [dialCode, setDialCode] = useState("+216");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      // Hard navigation (not router.replace+refresh): the @supabase/ssr auth
      // cookie is written synchronously, but a soft refresh can prefetch the
      // destination before the cookie propagates, leaving the render anonymous.
      const destination = next === "/" ? `/${locale}` : `/${locale}${next}`;

      if (mode === "phone") {
        // Phone sign-in is fully server-side (/api/auth/login-by-phone): the
        // phone→email resolution AND the sign-in happen on the server so the
        // account's email never reaches the client (the old email-by-phone
        // endpoint was a disclosure/enumeration oracle). The route writes the
        // auth cookie onto its response; we just reload.
        const check = validatePhone(dialCode, phoneNumber);
        if (!check.ok) {
          setError(check.reason);
          return;
        }
        const phone = normalizeE164(dialCode, phoneNumber);
        if (!phone) {
          setError("Numéro invalide.");
          return;
        }
        try {
          const res = await fetch("/api/auth/login-by-phone", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone, password }),
          });
          const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
          if (!data.ok) {
            // Generic wording — never reveals whether the phone is the problem
            // or the password (no account-enumeration signal).
            setError("Identifiants invalides. Vérifiez le numéro et le mot de passe.");
            return;
          }
        } catch {
          setError(
            "Impossible de joindre le serveur. Vérifiez votre connexion et réessayez.",
          );
          return;
        }
        window.location.assign(destination);
        return;
      }

      // Email mode — client-side sign-in (already enumeration-safe: Supabase
      // returns one generic error for unknown-user and wrong-password alike).
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setError(error.message);
        return;
      }
      window.location.assign(destination);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Mode toggle — two-pill segmented control. State is local; the
          form keeps both email and phone inputs mounted (each in their
          own conditional) so switching back doesn't wipe what was
          typed. */}
      <div
        role="tablist"
        aria-label="Méthode de connexion"
        className="grid grid-cols-2 gap-1 rounded-full bg-batta-surface-2 p-1 ring-1 ring-batta-gold/20"
      >
        <ModeTab active={mode === "email"} onClick={() => setMode("email")}>
          Email
        </ModeTab>
        <ModeTab active={mode === "phone"} onClick={() => setMode("phone")}>
          Téléphone
        </ModeTab>
      </div>

      {mode === "email" ? (
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          required
        />
      ) : (
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
      )}

      <Field
        label="Mot de passe"
        type="password"
        value={password}
        onChange={setPassword}
        required
      />
      <div className="-mt-1 flex justify-end">
        <Link
          href="/forgot-password"
          className="text-[11.5px] font-semibold text-batta-cream/75 hover:text-gold-bright"
        >
          Mot de passe oublié ?
        </Link>
      </div>
      {error && <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? (
          <><Loader2 className="inline size-4 animate-spin" /> Connexion…</>
        ) : (
          t("nav.login")
        )}
      </button>
    </form>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-batta-gold px-3 py-1.5 text-[12px] font-extrabold text-white shadow-[var(--shadow-gold)]"
          : "rounded-full px-3 py-1.5 text-[12px] font-semibold text-batta-cream/70 transition hover:text-batta-cream"
      }
    >
      {children}
    </button>
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
