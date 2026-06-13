"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { stripLocalePrefix } from "@/i18n/routing";
import { PhoneInput } from "./PhoneInput";
import { normalizeE164, validatePhone } from "@/lib/tunisia";

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

/**
 * Phone-only sign-in. Email auth was removed — the only identity is the phone
 * number (country-code chip + local digits). The sign-in itself is fully
 * server-side (/api/auth/login-by-phone): the phone→email resolution AND the
 * sign-in happen on the server so the account's synthetic email never reaches
 * the client. The route writes the auth cookie onto its response; we just reload.
 *
 * Honors `?next=/some/path` so users coming from a "Sign in to bid" link land
 * back where they were. The next-intl router prepends the active locale itself,
 * so we strip the redundant prefix from `next` to avoid `/ar/ar/...`.
 */
export function LoginForm() {
  const t = useTranslations();
  const locale = useLocale();
  const searchParams = useSearchParams();
  const rawNext = searchParams.get("next");
  const safeNext = safeNextPath(rawNext);
  const next = safeNext === "/" ? "/" : stripLocalePrefix(safeNext);

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
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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

      <Field
        label="Mot de passe"
        type="password"
        value={password}
        onChange={setPassword}
        required
        invalid={!!error}
        describedBy="login-error"
      />
      {error && <p id="login-error" role="alert" aria-live="assertive" className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>}
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

function Field({
  label, type, value, onChange, required, invalid, describedBy,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  /** Mark the field invalid + point AT to the error message (a11y). */
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <label className="block">
      <span className="batta-eyebrow text-[10px]">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? describedBy : undefined}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
      />
    </label>
  );
}
