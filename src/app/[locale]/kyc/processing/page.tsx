"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Loader2, AlertTriangle } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { clearKycDraft, readKycDraft } from "@/lib/kycDraft";

const TAG = "[KYC/processing]";

function log(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`%c${TAG} %c${ts}`, "color:#d4af37;font-weight:bold", "color:#888", ...args);
}
function err(...args: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`%c${TAG} %c${ts}`, "color:#ef4444;font-weight:bold", "color:#888", ...args);
}

interface DetailedError {
  message: string;
  code?: string;
  hint?: string;
  details?: string;
  raw?: unknown;
}

/**
 * Submit step. Reads the sessionStorage draft, upserts a `kyc_submissions`
 * row, optimistically flips the local user's `kycStatus` to "submitted",
 * clears the draft, and routes to /kyc/status. No fake progress theatre —
 * just a quiet spinner while the single upsert runs, then straight to the
 * status screen.
 *
 * Server-side, the `_mirror_kyc_submission` trigger flips
 * `profiles.kyc_status` to 'submitted' on insert; the client update() here
 * is purely for instant UI feedback.
 */
export default function KYCProcessingPage() {
  const router = useRouter();
  const { user, loaded, update } = useAuth();
  const [error, setError] = useState<DetailedError | null>(null);
  const submittedRef = useRef(false);

  const userRef = useRef(user);
  const updateRef = useRef(update);
  const routerRef = useRef(router);
  useEffect(() => {
    userRef.current = user;
    updateRef.current = update;
    routerRef.current = router;
  });

  useEffect(() => {
    if (!loaded) return;
    if (submittedRef.current) return;
    submittedRef.current = true;

    let unmounted = false;
    async function submit() {
      const u = userRef.current;
      if (!u) {
        if (!unmounted) setError({ message: "Utilisateur non identifié. Reconnectez-vous." });
        return;
      }

      const draft = readKycDraft();
      if (!draft.idFrontUrl || !draft.idBackUrl || !draft.selfieVideoUrl) {
        if (!unmounted)
          setError({ message: "Documents manquants. Reprenez la vérification depuis le début." });
        return;
      }

      const supabase = getBrowserSupabase();
      const fullName = u.fullName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");

      // Only user-controlled columns. reviewer_id / reviewed_at /
      // rejection_reason are admin-only (guard trigger) — omitting them
      // preserves any prior verdict's audit trail on re-submit.
      const payload = {
        user_id: u.id,
        full_name: fullName || null,
        id_front_url: draft.idFrontUrl,
        id_back_url: draft.idBackUrl,
        selfie_video_url: draft.selfieVideoUrl,
        selfie_image_url: draft.selfieImageUrl ?? null,
        status: "submitted" as const,
        submitted_at: new Date().toISOString(),
      };

      const upsertResp = await supabase
        .from("kyc_submissions")
        .upsert(payload, { onConflict: "user_id" })
        .select()
        .single();

      if (upsertResp.error) {
        const e = upsertResp.error;
        err("kyc_submissions upsert failed", e);
        if (!unmounted) {
          setError({ message: e.message, code: e.code, hint: e.hint, details: e.details, raw: e });
        }
        return;
      }

      await updateRef.current({ kycStatus: "submitted" });
      clearKycDraft();
      log("submitted — redirecting → /kyc/status");
      routerRef.current.replace("/kyc/status");
    }

    submit().catch((e) => {
      err("submit() threw", e);
      if (!unmounted) {
        setError({
          message: e instanceof Error ? e.message : "Erreur inattendue lors de l'envoi",
          raw: e,
        });
      }
    });
    return () => {
      unmounted = true;
    };
  }, [loaded]);

  if (error) {
    return (
      <KYCShell current={3}>
        <div className="space-y-6 py-8 text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-red-500/15 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-red-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Une erreur est survenue</h2>
            <p className="text-sm text-[var(--foreground-muted)] mt-2 leading-relaxed">
              {error.message}
            </p>
            {(error.code || error.hint || error.details) && (
              <div className="mt-3 text-start text-[11px] font-mono text-[var(--foreground-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius)] p-3 space-y-1">
                {error.code && <div>code: {error.code}</div>}
                {error.hint && <div>hint: {error.hint}</div>}
                {error.details && <div>details: {error.details}</div>}
              </div>
            )}
          </div>
          <Button size="lg" fullWidth onClick={() => router.push("/kyc/start")}>
            Recommencer
          </Button>
        </div>
      </KYCShell>
    );
  }

  return (
    <KYCShell current={3}>
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--gold)]" />
        <p className="text-sm text-[var(--foreground-muted)]">Envoi de votre dossier…</p>
      </div>
    </KYCShell>
  );
}
