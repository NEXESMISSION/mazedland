"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "@/i18n/navigation";
import { Camera, Eye, ArrowRight, ArrowLeft } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { updateKycDraft, readKycDraft, clearKycDraft } from "@/lib/kycDraft";

// LivenessCheck is ~950 lines and pulls in the camera/detection machinery
// (it lazy-loads face-api on top of that). It only renders after the user
// taps "Commencer", so we code-split it out of the selfie route's initial
// bundle — nothing of it ships until the check actually starts. ssr:false
// because it's camera/DOM-only and has no meaningful server render.
const LivenessCheck = dynamic(
  () => import("@/components/auction/LivenessCheck").then((m) => m.LivenessCheck),
  { ssr: false },
);

export default function KYCSelfiePage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user, update } = useAuth();
  // Bumped on retry so LivenessCheck remounts cleanly (camera + models
  // re-init from scratch instead of resuming from torn-down refs).
  const [attemptKey, setAttemptKey] = useState(0);
  // Gate LivenessCheck behind an explicit "Commencer" tap. The tap
  // doubles as a user gesture for the browser autoplay policy — without
  // it, the AudioContext we create inside LivenessCheck stays in the
  // `suspended` state and the per-step beeps never play.
  const [started, setStarted] = useState(false);

  const POSES = [
    { Icon: Eye, label: "Face" },
    { Icon: ArrowRight, label: "Droite" },
    { Icon: ArrowLeft, label: "Gauche" },
  ];

  return (
    <KYCShell current={2} backHref="/kyc/id-back">
      {started ? (
        <LivenessCheck
          key={attemptKey}
          onComplete={async ({ videoUrl, imageUrl }) => {
            // Submit the whole dossier right here and go straight to the
            // status screen — no separate "processing" page in between.
            updateKycDraft({ selfieVideoUrl: videoUrl, selfieImageUrl: imageUrl });
            const draft = readKycDraft();
            const supabase = getBrowserSupabase();
            const { data: { user: liveUser } } = await supabase.auth.getUser();
            if (!liveUser || !draft.idFrontUrl || !draft.idBackUrl || !draft.selfieVideoUrl) {
              toast("Documents manquants. Reprenez la vérification.", "error");
              router.replace("/kyc/start");
              return;
            }
            const fullName =
              user?.fullName ?? [user?.firstName, user?.lastName].filter(Boolean).join(" ");
            const { error } = await supabase.from("kyc_submissions").upsert(
              {
                user_id: liveUser.id,
                full_name: fullName || null,
                id_front_url: draft.idFrontUrl,
                id_back_url: draft.idBackUrl,
                selfie_video_url: draft.selfieVideoUrl,
                selfie_image_url: draft.selfieImageUrl ?? null,
                status: "submitted" as const,
                submitted_at: new Date().toISOString(),
              },
              { onConflict: "user_id" },
            );
            if (error) {
              toast(error.message || "Échec de l'envoi du dossier.", "error");
              return;
            }
            await update({ kycStatus: "submitted" });
            clearKycDraft();
            router.replace("/kyc/status");
          }}
          onCancel={() => {
            setStarted(false);
            setAttemptKey((k) => k + 1);
          }}
        />
      ) : (
        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-bold">Selfie de vérification</h2>
            <p className="text-sm text-[var(--foreground-muted)] mt-1">
              Suivez 3 poses simples à l&apos;écran.
            </p>
          </div>

          {/* Three poses — at a glance, no paragraph. */}
          <div className="grid grid-cols-3 gap-2.5">
            {POSES.map((p, i) => (
              <div
                key={p.label}
                className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] py-4"
              >
                <span className="relative h-10 w-10 rounded-full bg-[var(--gold-faint)] text-[var(--gold)] flex items-center justify-center">
                  <p.Icon className="h-5 w-5" />
                  <span className="absolute -top-1.5 -end-1.5 grid size-4 place-items-center rounded-full bg-[var(--gold)] text-[9px] font-extrabold text-white">
                    {i + 1}
                  </span>
                </span>
                <span className="text-[12px] font-bold">{p.label}</span>
              </div>
            ))}
          </div>

          {/* One short tip line. */}
          <p className="flex items-center justify-center gap-1.5 text-center text-[11.5px] text-[var(--foreground-muted)]">
            <Camera className="h-3.5 w-3.5 shrink-0 text-[var(--gold)]" />
            Bon éclairage, visage centré, sans lunettes.
          </p>

          <Button size="lg" fullWidth onClick={() => setStarted(true)}>
            <Camera className="h-5 w-5" />
            Commencer
          </Button>
        </div>
      )}
    </KYCShell>
  );
}
