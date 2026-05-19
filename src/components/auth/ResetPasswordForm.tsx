"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { CheckCircle2 } from "lucide-react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Sits on /reset-password. Supabase's recovery email link drops the
 * user here with a `type=recovery` token in the URL fragment; the JS
 * client picks it up and establishes a short-lived session. The form
 * then calls auth.updateUser to set the new password.
 *
 * We watch for the `PASSWORD_RECOVERY` auth event so we know the
 * client successfully consumed the token. If no session ever shows up
 * (expired link, tampered URL), we render an error card with a path
 * back to /forgot-password.
 */
export function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState<"loading" | "ok" | "invalid">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let resolved = false;

    // PASSWORD_RECOVERY fires when the JS client processes the recovery
    // token from the URL fragment. We listen for it so the form
    // un-disables itself at the right moment.
    const { data: sub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === "PASSWORD_RECOVERY") {
        resolved = true;
        setReady("ok");
      }
    });

    // Fallback — sometimes the event fires before our listener is
    // attached. Probe the session synchronously and bail to invalid
    // if nothing's there after a beat.
    void supabase.auth.getSession().then(({ data }: { data: { session: unknown | null } }) => {
      if (data.session) {
        resolved = true;
        setReady("ok");
      }
    });
    const t = setTimeout(() => {
      if (!resolved) setReady("invalid");
    }, 1500);

    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  function onSubmit(e: React.FormEvent) {
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
    startTransition(async () => {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setError(error.message);
        return;
      }
      setDone(true);
      // Short pause so the user reads the success state, then back to
      // /login with the new password.
      setTimeout(() => router.replace("/login"), 1600);
    });
  }

  if (ready === "loading") {
    return (
      <div className="text-center text-[12.5px] text-muted">
        Vérification du lien…
      </div>
    );
  }

  if (ready === "invalid") {
    return (
      <div className="batta-tone-bad rounded-lg px-3 py-3 text-center text-xs">
        Lien invalide ou expiré.{" "}
        <a href="/fr/forgot-password" className="font-bold underline">
          Demander un nouveau lien
        </a>
        .
      </div>
    );
  }

  if (done) {
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
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
        <p className="batta-tone-bad rounded-lg px-3 py-2 text-xs">{error}</p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="batta-btn-luxe tap-target w-full px-5 py-3 text-[13.5px] disabled:opacity-50"
      >
        {isPending ? "Mise à jour…" : "Mettre à jour le mot de passe"}
      </button>
    </form>
  );
}
