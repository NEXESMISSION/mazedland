"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Loader2, Smartphone, CheckCircle2 } from "lucide-react";
import { PhoneInput } from "./PhoneInput";
import { normalizeE164, validatePhone } from "@/lib/tunisia";

/**
 * Phone-OTP password recovery (phone-only app — there is no email inbox).
 *
 * Three self-contained steps on /forgot-password:
 *   1. phone     → POST /api/auth/phone/send   (SMS code)
 *   2. otp       → POST /api/auth/phone/verify (stamps a short-lived verified_at proof)
 *   3. password  → POST /api/auth/reset-password (server checks the proof, then
 *                  admin-updates the password) → redirect to /login.
 *
 * The OTP proof is server-side (phone_otps.verified_at keyed by phone) so the
 * client never holds a recovery token. Reuses the exact send/verify routes the
 * signup flow uses.
 */
type Phase = "phone" | "otp" | "password" | "done";

export function ForgotPasswordForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("phone");
  const [dialCode, setDialCode] = useState("+216");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phone, setPhone] = useState<string | null>(null); // normalized E.164
  const [otpCode, setOtpCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [isPending, startTransition] = useTransition();

  // Tick the resend cooldown.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Step 1 — request an SMS code for the entered number.
  function onSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const check = validatePhone(dialCode, phoneNumber);
    if (!check.ok) {
      setError(check.reason);
      return;
    }
    const normalized = normalizeE164(dialCode, phoneNumber);
    if (!normalized) {
      setError("Numéro invalide.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/phone/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: normalized }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          configured?: boolean;
          error?: string;
          retryAfter?: number;
        };
        // SMS off → there is no recovery channel for phone-only accounts.
        if (res.ok && j.configured === false) {
          setError(
            "La réinitialisation par SMS n'est pas disponible pour le moment. Contactez le support.",
          );
          return;
        }
        if (res.ok && j.ok) {
          setPhone(normalized);
          setPhase("otp");
          setOtpCode("");
          setCooldown(60);
          return;
        }
        // 429 → a code is already out / hourly cap — let them enter what they have.
        if (res.status === 429) {
          setPhone(normalized);
          setPhase("otp");
          setCooldown(j.error === "cooldown" ? j.retryAfter ?? 60 : 60);
          return;
        }
        if (res.status === 400 && j.error === "invalid_phone") {
          setError("Numéro de téléphone invalide.");
          return;
        }
        setError("Impossible d'envoyer le code SMS. Réessayez dans un instant.");
      } catch {
        setError("Impossible de joindre le serveur. Réessayez.");
      }
    });
  }

  // Step 2 — verify the 6-digit code (stamps the server-side proof).
  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const clean = otpCode.replace(/\D/g, "");
    if (clean.length !== 6) {
      setError("Entrez le code à 6 chiffres.");
      return;
    }
    if (!phone) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/phone/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, code: clean }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && j.ok) {
          setPhase("password");
          return;
        }
        const map: Record<string, string> = {
          wrong_code: "Code incorrect.",
          expired: "Code expiré. Redemandez-en un.",
          no_code: "Aucun code en cours. Redemandez-en un.",
          too_many_attempts: "Trop de tentatives. Redemandez un code.",
        };
        setError(map[j.error ?? ""] ?? "Échec de la vérification.");
      } catch {
        setError("Erreur réseau. Réessayez.");
      }
    });
  }

  function resend() {
    if (cooldown > 0 || !phone) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/phone/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; retryAfter?: number; error?: string };
        if (res.ok && j.ok) setCooldown(60);
        else if (res.status === 429 && j.error === "cooldown") setCooldown(j.retryAfter ?? 60);
        else setError("Échec du renvoi. Réessayez.");
      } catch {
        setError("Erreur réseau. Réessayez.");
      }
    });
  }

  // Step 3 — set the new password (server re-checks the OTP proof).
  function onSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Le mot de passe doit comporter au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    if (!phone) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, password }),
        });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && j.ok) {
          setPhase("done");
          setTimeout(() => router.replace("/login"), 1600);
          return;
        }
        const map: Record<string, string> = {
          weak_password: "Mot de passe trop court (8 caractères minimum).",
          no_account: "Aucun compte n'est associé à ce numéro.",
          rate_limited: "Trop de tentatives. Réessayez dans un instant.",
        };
        if (j.error === "phone_not_verified") {
          // Proof expired between verify and submit — restart from the top.
          setError("Vérification expirée. Recommencez la procédure.");
          setPhase("phone");
          setOtpCode("");
          return;
        }
        setError(map[j.error ?? ""] ?? "Impossible de réinitialiser le mot de passe. Réessayez.");
      } catch {
        setError("Impossible de joindre le serveur. Réessayez.");
      }
    });
  }

  if (phase === "done") {
    return (
      <div className="batta-frame-gold p-6 text-center">
        <span className="batta-monogram batta-monogram-filled mx-auto mb-3 size-12 text-[18px]">
          <CheckCircle2 className="size-5" strokeWidth={1.75} />
        </span>
        <h2 className="batta-serif text-[16px] font-semibold text-batta-cream">
          Mot de passe mis à jour
        </h2>
        <p className="mt-2 text-[12.5px] text-batta-cream/75">
          Redirection vers la page de connexion…
        </p>
      </div>
    );
  }

  if (phase === "otp") {
    return (
      <form onSubmit={onVerify} className="batta-frame-gold relative p-6 text-center">
        <span className="batta-monogram batta-monogram-filled mx-auto mb-3 size-12 text-[18px]">
          <Smartphone className="size-5" strokeWidth={1.75} />
        </span>
        <h2 className="batta-serif text-[18px] font-semibold text-batta-cream">
          Vérifiez votre numéro
        </h2>
        <p className="mt-2 text-sm text-batta-cream/75">
          Entrez le code à 6 chiffres envoyé par SMS au{" "}
          <span className="font-bold text-batta-cream">{phone}</span>.
        </p>

        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
          placeholder="••••••"
          aria-label="Code de vérification à 6 chiffres"
          className="mt-5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-3 text-center text-[22px] font-bold tracking-[0.4em] text-batta-cream placeholder:text-batta-muted focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
        />

        {error && (
          <p role="alert" aria-live="assertive" className="batta-tone-bad mt-3 rounded-lg px-3 py-2 text-xs">{error}</p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="submit"
            disabled={isPending || otpCode.replace(/\D/g, "").length !== 6}
            className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13px] disabled:opacity-50"
          >
            {isPending ? (
              <><Loader2 className="inline size-4 animate-spin" /> Vérification…</>
            ) : (
              "Vérifier le code"
            )}
          </button>
          <button
            type="button"
            onClick={resend}
            disabled={cooldown > 0 || isPending}
            className="batta-btn-ghost-gold tap-target w-full px-5 py-3 text-[13px] disabled:opacity-50"
          >
            {cooldown > 0 ? `Renvoyer le code (${cooldown}s)` : "Renvoyer le code"}
          </button>
          <button
            type="button"
            onClick={() => { setPhase("phone"); setError(null); setOtpCode(""); }}
            className="text-[12px] text-batta-cream/70 hover:text-gold-bright"
          >
            Changer de numéro
          </button>
        </div>
      </form>
    );
  }

  if (phase === "password") {
    return (
      <form onSubmit={onSetPassword} className="space-y-4">
        <label className="block">
          <span className="batta-eyebrow text-[10px]">Nouveau mot de passe (min 8)</span>
          <input
            type="password"
            required
            minLength={8}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
          />
        </label>
        <label className="block">
          <span className="batta-eyebrow text-[10px]">Confirmer</span>
          <input
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-batta-gold/25 bg-batta-surface-2 px-4 py-2.5 text-sm text-batta-cream focus:border-batta-gold focus:outline-none focus:ring-1 focus:ring-batta-gold/40"
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
          {isPending ? (
            <><Loader2 className="inline size-4 animate-spin" /> Mise à jour…</>
          ) : (
            "Mettre à jour le mot de passe"
          )}
        </button>
      </form>
    );
  }

  // phase === "phone"
  return (
    <form onSubmit={onSendCode} className="space-y-4">
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
      {error && (
        <p role="alert" aria-live="assertive" className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? (
          <><Loader2 className="inline size-4 animate-spin" /> Envoi…</>
        ) : (
          "Envoyer le code SMS"
        )}
      </button>
    </form>
  );
}
