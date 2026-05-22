"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { ShieldCheck, ArrowRight, BadgeCheck, Gavel, Home } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { getBrowserSupabase } from "@/lib/supabase/client";

const DISMISS_KEY = "batta:kyc-nudge-dismissed";

type KycStatus = "none" | "submitted" | "verified" | "rejected" | null;

/**
 * Soft-gate that nudges signed-in users whose KYC isn't verified to
 * complete it. Fires once per browser session — clicking "Plus tard"
 * sets a sessionStorage flag, so the prompt comes back next sign-in but
 * doesn't follow them between every page hop in the current session.
 *
 * Mounted globally from MobileShell on non-flow routes (excludes /kyc,
 * /payment, auth flows). On those routes the user is already in the
 * funnel — re-prompting is noise.
 */
export function KYCNudgeModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<KycStatus>(null);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  useEffect(() => {
    // Single async effect: peek at user + KYC status, decide whether to
    // open. Bail out for anonymous visitors, verified accounts, and
    // submissions currently under review — those don't need a nudge.
    let cancelled = false;
    (async () => {
      if (typeof window === "undefined") return;
      if (sessionStorage.getItem(DISMISS_KEY) === "1") return;

      const sb = getBrowserSupabase();
      const { data: { user } } = await sb.auth.getUser();
      if (!user || cancelled) return;

      const { data: profile } = await sb
        .from("profiles")
        .select("kyc_status")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled || !profile) return;

      const s = profile.kyc_status as KycStatus;
      if (s !== "none" && s !== "rejected") return;

      // For rejected status, surface the reviewer's reason from the
      // latest kyc_submissions row so the user knows what to fix.
      if (s === "rejected") {
        const { data: sub } = await sb
          .from("kyc_submissions")
          .select("reviewer_notes")
          .eq("user_id", user.id)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && sub?.reviewer_notes) {
          setRejectionReason(sub.reviewer_notes);
        }
      }
      if (!cancelled) {
        setStatus(s);
        setOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  }

  function goVerify() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
    router.push("/kyc/start");
  }

  if (!open || !status) return null;

  const isRejected = status === "rejected";

  return (
    <Modal
      open={open}
      onClose={dismiss}
      size="md"
      title={isRejected ? "Vérification à refaire" : "Vérifiez votre identité"}
      description={
        isRejected
          ? "Votre dossier précédent a été refusé. Reprenez la vérification pour pouvoir enchérir et publier."
          : "Pour enchérir, vendre ou publier sur Batta, votre identité doit être vérifiée. Ça prend environ 2 minutes."
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-2xl bg-[var(--gold-faint)] p-4 ring-1 ring-[var(--gold)]/15">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--gold)] text-white shadow-[var(--shadow-gold)]">
            <ShieldCheck className="size-5" strokeWidth={2.2} />
          </span>
          <div className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground/85">
            <p className="font-bold text-foreground">Cadre légal tunisien</p>
            <p className="mt-0.5 text-muted">
              Vos données sont chiffrées et traitées conformément à la loi n°2004-63.
              Seuls les administrateurs Batta y accèdent.
            </p>
          </div>
        </div>

        {isRejected && rejectionReason && (
          <div className="rounded-2xl border border-[var(--danger)]/25 bg-[var(--danger)]/5 p-3.5 text-[12px]">
            <p className="font-bold text-[var(--danger)]">Motif du refus</p>
            <p className="mt-1 text-foreground/80">{rejectionReason}</p>
          </div>
        )}

        <ul className="space-y-2.5 text-[12.5px]">
          <Benefit
            Icon={Gavel}
            label="Enchérir sur les biens"
            sub="Placez des offres en temps réel sur les ventes en cours."
          />
          <Benefit
            Icon={Home}
            label="Vendre votre bien"
            sub="Publiez une annonce ou organisez une enchère sur Batta."
          />
          <Benefit
            Icon={BadgeCheck}
            label="Badge identité vérifiée"
            sub="Plus de visibilité, plus de confiance côté acheteur."
          />
        </ul>
      </div>

      <ModalFooter>
        <Button variant="secondary" onClick={dismiss}>
          Plus tard
        </Button>
        <Button onClick={goVerify}>
          {isRejected ? "Refaire la vérification" : "Commencer maintenant"}
          <ArrowRight className="size-4" />
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function Benefit({
  Icon, label, sub,
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  sub: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--surface-2)] text-[var(--gold)] ring-1 ring-[var(--border)]">
        <Icon className="size-4" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold text-foreground">{label}</span>
        <span className="block text-[11.5px] leading-snug text-muted">{sub}</span>
      </span>
    </li>
  );
}
