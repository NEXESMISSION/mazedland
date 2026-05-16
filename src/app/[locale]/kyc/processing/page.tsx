"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Check, AlertTriangle } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { clearKycDraft, readKycDraft } from "@/lib/kycDraft";

const CHECK_LABELS = [
  "Téléversement des documents…",
  "Enregistrement du dossier…",
  "Mise en file d'attente pour vérification…",
] as const;

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
 * Submit step. Reads the sessionStorage draft, inserts (upserts) a
 * `kyc_submissions` row, optimistically flips the local user's
 * `kycStatus` to "pending", clears the draft, and routes to /kyc/status.
 *
 * Server-side, the `_mirror_kyc_submission` trigger (0006_security_lockdown
 * migration) flips `profiles.kyc_status` to 'submitted' on insert — the
 * client-side update() here is purely for instant UI feedback. Required
 * DB schema (Part 4 migration): `id_front_url`, `id_back_url`,
 * `selfie_video_url`, `selfie_image_url`, plus `full_name`.
 */
export default function KYCProcessingPage() {
  const router = useRouter();
  const { user, loaded, update } = useAuth();
  const [step, setStep] = useState(0);
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
    log("mount", {
      loaded,
      hasUser: Boolean(userRef.current),
      userId: userRef.current?.id,
    });
    if (!loaded) {
      log("waiting for auth.loaded …");
      return;
    }
    if (submittedRef.current) {
      log("submit already attempted, skipping");
      return;
    }
    submittedRef.current = true;

    let unmounted = false;
    async function submit() {
      log("submit() start");
      const u = userRef.current;
      if (!u) {
        err("no user in context — aborting");
        if (!unmounted)
          setError({ message: "Utilisateur non identifié. Reconnectez-vous." });
        return;
      }
      log("user", {
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        kycStatus: u.kycStatus,
      });

      const draft = readKycDraft();
      log("draft", draft);
      if (!draft.idFrontUrl || !draft.idBackUrl || !draft.selfieVideoUrl) {
        err("draft incomplete", {
          hasFront: Boolean(draft.idFrontUrl),
          hasBack: Boolean(draft.idBackUrl),
          hasSelfie: Boolean(draft.selfieVideoUrl),
        });
        if (!unmounted)
          setError({
            message:
              "Documents manquants. Reprenez la vérification depuis le début.",
          });
        return;
      }

      const advance = (i: number) =>
        new Promise<void>((res) =>
          setTimeout(() => {
            if (!unmounted) setStep(i);
            res();
          }, 700),
        );

      log("advance → step 1 (upload phase visual)");
      await advance(1);

      const supabase = getBrowserSupabase();
      const fullName = u.fullName ?? [u.firstName, u.lastName].filter(Boolean).join(" ");

      // Only the user-controlled columns. reviewer_id / reviewed_at /
      // rejection_reason are admin-only and protected by the
      // _guard_kyc_submission_self_update trigger (migration 0016).
      // Omitting them is the right call on UPSERT: on INSERT they
      // default to null, on UPDATE they're left untouched, which
      // preserves the previous admin verdict's audit trail.
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
      log("upserting kyc_submissions", payload);

      const t0 = performance.now();
      const upsertResp = await supabase
        .from("kyc_submissions")
        .upsert(payload, { onConflict: "user_id" })
        .select()
        .single();
      const upsertMs = Math.round(performance.now() - t0);
      log("kyc_submissions response", {
        ms: upsertMs,
        status: upsertResp.status,
        statusText: upsertResp.statusText,
        data: upsertResp.data,
        error: upsertResp.error,
      });

      if (upsertResp.error) {
        const e = upsertResp.error;
        err("kyc_submissions upsert failed", e);
        if (!unmounted) {
          setError({
            message: e.message,
            code: e.code,
            hint: e.hint,
            details: e.details,
            raw: e,
          });
        }
        return;
      }

      log("advance → step 2 (record saved)");
      await advance(2);

      log("optimistic update({ kycStatus: 'submitted' })");
      const updateResp = await updateRef.current({ kycStatus: "submitted" });
      log("update response", updateResp);

      log("advance → step 3 (queued for review)");
      await advance(3);

      log("clearing draft + redirecting → /kyc/status");
      clearKycDraft();
      routerRef.current.push("/kyc/status");
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
      log("effect cleanup");
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
            <p className="text-[10px] text-[var(--foreground-subtle)] mt-2">
              Détails dans la console du navigateur (préfixe [KYC/processing]).
            </p>
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
      <div className="space-y-6 py-6">
        <div className="text-center">
          <div className="mx-auto h-20 w-20 mb-4 relative">
            <div className="absolute inset-0 rounded-full border-4 border-[var(--gold)] border-t-transparent animate-spin" />
            <div className="absolute inset-3 rounded-full bg-[var(--gold-faint)]" />
          </div>
          <h2 className="text-xl font-bold">Vérification en cours…</h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-1">
            Quelques secondes — ne fermez pas l&apos;onglet.
          </p>
        </div>

        <div className="space-y-2">
          {CHECK_LABELS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <div
                key={label}
                className="flex items-center gap-3 p-3 rounded-[var(--radius)] bg-[var(--surface)] border border-[var(--border)]"
              >
                <div
                  className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
                    done
                      ? "bg-green-500 text-white"
                      : active
                        ? "bg-[var(--gold-faint)] border-2 border-[var(--gold)]"
                        : "bg-[var(--surface-2)]"
                  }`}
                >
                  {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  {active && (
                    <div className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />
                  )}
                </div>
                <span
                  className={`text-sm ${
                    done
                      ? "text-foreground"
                      : active
                        ? "text-[var(--gold)] font-semibold"
                        : "text-[var(--foreground-subtle)]"
                  }`}
                >
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </KYCShell>
  );
}
