"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Camera, Check, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { KYCShell } from "@/components/layout/KYCShell";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { NativeCapture } from "@/components/auction/NativeCapture";
import { updateKycDraft } from "@/lib/kycDraft";

export default function KYCIdBackPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [url, setUrl] = useState<string | null>(null);

  return (
    <KYCShell current={1} backHref="/kyc/id-front">
      <div className="space-y-5">
        <div className="text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--gold-faint)] text-[10px] uppercase tracking-wider font-bold text-[var(--gold)] mb-3">
            Étape 2 / 4
          </div>
          <h2 className="text-xl font-extrabold">Photographiez le verso de votre CIN</h2>
          <p className="text-sm text-[var(--foreground-muted)] mt-1.5">
            Côté avec votre adresse et la signature.
          </p>
        </div>

        {url ? (
          <div className="relative aspect-[4/3] rounded-[var(--radius-md)] overflow-hidden border-2 border-[var(--success)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt="CIN verso"
              className="h-full w-full object-cover"
            />
            <div className="absolute top-2 end-2 h-7 w-7 rounded-full bg-[var(--success)] flex items-center justify-center">
              <Check className="h-4 w-4 text-white" strokeWidth={3} />
            </div>
          </div>
        ) : (
          <NativeCapture
            kind="photo"
            facing="environment"
            folder="kyc"
            label="Photographier le verso"
            onCaptured={(u) => {
              setUrl(u);
              updateKycDraft({ idBackUrl: u });
            }}
          >
            {({ open, uploading }) => (
              <button
                onClick={open}
                disabled={uploading}
                className="relative aspect-[4/3] w-full rounded-[var(--radius-md)] border-2 border-dashed border-[var(--border)] hover:border-[var(--gold)] bg-[var(--surface)] overflow-hidden transition-colors"
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                  <Camera className="h-8 w-8 text-[var(--gold)]" />
                  <div className="text-sm font-semibold">Photographier le verso</div>
                  <div className="text-[11px] text-[var(--foreground-muted)]">
                    Touchez pour ouvrir l&apos;appareil photo
                  </div>
                </div>
                {uploading && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <Loader2 className="h-8 w-8 text-[var(--gold)] animate-spin" />
                  </div>
                )}
              </button>
            )}
          </NativeCapture>
        )}

        <ul className="text-xs text-[var(--foreground-muted)] space-y-1.5 px-1">
          <Tip text="Adresse et signature bien visibles" />
          <Tip text="Évitez les ombres sur la carte" />
          <Tip text="Cadrez les quatre coins" />
        </ul>

        {url && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onClick={() => setUrl(null)}
            >
              <RotateCcw className="h-4 w-4" />
              Reprendre
            </Button>
            <Button
              size="lg"
              fullWidth
              onClick={() => {
                toast("Verso capturé", "success");
                router.push("/kyc/selfie");
              }}
            >
              Continuer
            </Button>
          </div>
        )}
      </div>
    </KYCShell>
  );
}

function Tip({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2">
      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--gold)] shrink-0" />
      {text}
    </li>
  );
}
