"use client";

import { useState, useTransition } from "react";
import { MailCheck } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Single email field that triggers Supabase's password-recovery email.
 * On success we show a confirmation card — no leak of whether the
 * address has an account (Supabase responds 200 for unknown emails too,
 * which is the right behaviour: it stops account-enumeration).
 *
 * The recovery email's link targets /reset-password where the user
 * picks a new password against the temporary recovery session that
 * Supabase establishes.
 */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const redirectTo = `${origin}/fr/reset-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo,
      });
      if (error) {
        // Real errors (network, env missing) — surface. We don't surface
        // "no account" because Supabase doesn't tell us that anyway.
        setError(error.message);
        return;
      }
      setSent(true);
    });
  }

  if (sent) {
    return (
      <div className="batta-frame-gold relative p-6 text-center">
        <div className="relative">
          <span className="batta-monogram batta-monogram-filled mx-auto mb-3 size-12 text-[18px]">
            <MailCheck className="size-5" strokeWidth={1.75} />
          </span>
          <h2 className="batta-serif text-[16px] font-semibold text-batta-cream">
            Email envoyé
          </h2>
          <p className="mt-2 text-[12.5px] text-batta-cream/75">
            Si un compte existe pour <span className="font-bold">{email}</span>,
            un lien de réinitialisation vient d&apos;être envoyé. Vérifiez
            aussi votre dossier spam.
          </p>
          <p className="mt-3 text-[11px] text-batta-muted">
            Le lien est valable 60 minutes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="batta-eyebrow text-[10px]">Email</span>
        <input
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        />
      </label>
      {error && (
        <p role="alert" aria-live="assertive" className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? "Envoi…" : "Envoyer le lien de réinitialisation"}
      </button>
    </form>
  );
}
