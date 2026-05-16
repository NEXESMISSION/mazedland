"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Camera, Eye, Volume2, ArrowRight, ArrowLeft } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { LivenessCheck } from "@/components/auction/LivenessCheck";
import { updateKycDraft } from "@/lib/kycDraft";

export default function KYCSelfiePage() {
  const router = useRouter();
  const { toast } = useToast();
  // Bumped on retry so LivenessCheck remounts cleanly (camera + models
  // re-init from scratch instead of resuming from torn-down refs).
  const [attemptKey, setAttemptKey] = useState(0);
  // Gate LivenessCheck behind an explicit "Commencer" tap. The tap
  // doubles as a user gesture for the browser autoplay policy — without
  // it, the AudioContext we create inside LivenessCheck stays in the
  // `suspended` state and the per-step beeps never play.
  const [started, setStarted] = useState(false);

  return (
    <KYCShell current={2} backHref="/kyc/id-back">
      <div className="space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-bold">Selfie avec mouvement de tête</h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-1">
            Trois poses rapides — face, droite, gauche. Suivez les instructions à l&apos;écran.
          </p>
        </div>

        {started ? (
          <LivenessCheck
            key={attemptKey}
            onComplete={({ videoUrl, imageUrl }) => {
              updateKycDraft({
                selfieVideoUrl: videoUrl,
                selfieImageUrl: imageUrl,
              });
              toast("Selfie validé", "success");
              router.push("/kyc/processing");
            }}
            onCancel={() => {
              setStarted(false);
              setAttemptKey((k) => k + 1);
            }}
          />
        ) : (
          <div className="space-y-4">
            <div className="rounded-[var(--radius-md)] bg-[var(--surface)] border border-[var(--border)] p-4 space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="h-9 w-9 rounded-full bg-[var(--gold-faint)] text-[var(--gold)] flex items-center justify-center shrink-0">
                  <Camera className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-bold text-sm">Préparez-vous</div>
                  <div className="text-[11px] text-[var(--foreground-muted)] mt-0.5">
                    Bon éclairage, visage centré, sans lunettes de soleil.
                  </div>
                </div>
              </div>
              <ul className="space-y-1.5 text-xs text-[var(--foreground-muted)] ms-1">
                <li className="flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
                  Regardez droit devant
                </li>
                <li className="flex items-center gap-2">
                  <ArrowRight className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
                  Puis tournez à droite
                </li>
                <li className="flex items-center gap-2">
                  <ArrowLeft className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
                  Puis tournez à gauche
                </li>
                <li className="flex items-center gap-2">
                  <Volume2 className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
                  Un bip confirme chaque pose
                </li>
              </ul>
            </div>

            <Button
              size="lg"
              fullWidth
              onClick={() => setStarted(true)}
            >
              <Camera className="h-5 w-5" />
              Commencer le selfie
            </Button>
          </div>
        )}
      </div>
    </KYCShell>
  );
}
