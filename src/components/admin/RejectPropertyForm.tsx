"use client";

import { useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import { Loader2, X, ArrowLeft, Check } from "lucide-react";
import {
  encodeRejection,
  REJECTION_CATEGORY_LABELS,
  type RejectionCategory,
  type RejectionMode,
} from "@/lib/rejection";
import { Eye, EyeOff } from "lucide-react";

// Each preset carries the rejection category so the seller's edit
// screen can ring-highlight exactly which section to fix instead of
// making them re-walk the whole form. Clicking a preset:
//   - toggles its category on/off (multi-select)
//   - appends its text into the motif (or removes it if you re-click)
// so the admin can stack "Photos floues" + "Documents manquants"
// rejections in one submission.
const PRESETS: { label: string; text: string; category: RejectionCategory }[] = [
  {
    label: "Photos floues / mauvaise qualité",
    category: "photos",
    text: "Les photos ne sont pas exploitables (flou, sombre, recadrage incorrect). Merci de reprendre des clichés nets en plein jour.",
  },
  {
    label: "Titre foncier illisible",
    category: "documents",
    text: "Le titre foncier joint n'est pas lisible. Merci de le scanner ou de le re-photographier à plat avec un bon éclairage.",
  },
  {
    label: "Documents manquants",
    category: "documents",
    text: "Des documents juridiques essentiels (titre foncier, certificat de propriété, permis de bâtir si villa) sont manquants. Merci de les joindre.",
  },
  {
    label: "Adresse incomplète",
    category: "address",
    text: "L'adresse fournie est incomplète ou imprécise. Renseignez le gouvernorat, la délégation et un repère (route, km, quartier).",
  },
  {
    label: "Prix incohérent / hors marché",
    category: "price",
    text: "Le prix indiqué semble incohérent avec le marché pour ce type de bien dans ce gouvernorat. Revoyez l'estimation ou joignez un justificatif.",
  },
  {
    label: "Description trop courte",
    category: "description",
    text: "La description est insuffisante pour qu'un acheteur se projette. Détaillez la superficie, l'état général, l'environnement et les servitudes éventuelles.",
  },
];

export function RejectPropertyForm({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  // Categories are a Set (order preserved via Array storage). Toggling
  // a preset chip flips its category here; chips below the textarea
  // also let the admin tag a category without grabbing a preset text.
  const [categories, setCategories] = useState<RejectionCategory[]>([]);
  // Default to "focused" — the seller only sees the marked sections,
  // not the whole form. Admin can flip to "full" when they want the
  // seller to review surrounding fields too. Stored in the bracket
  // prefix so the seller's edit page picks it up.
  const [mode, setMode] = useState<RejectionMode>("focused");
  const [pending, start] = useTransition();

  function toggleCategory(c: RejectionCategory) {
    setCategories((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  function togglePreset(p: typeof PRESETS[number]) {
    const has = reason.includes(p.text);
    if (has) {
      // Remove the preset text and (best-effort) its trailing newlines.
      const next = reason.replace(p.text, "").replace(/\n{3,}/g, "\n\n").trim();
      setReason(next);
      // Only remove the category if no other preset of the same category
      // is still present in the textarea — otherwise the multi-doc case
      // ("Titre illisible" + "Docs manquants" both = documents) would
      // drop the tag when the first is removed.
      const stillTagged = PRESETS.some(
        (x) =>
          x !== p && x.category === p.category && reason.includes(x.text),
      );
      if (!stillTagged) {
        setCategories((prev) => prev.filter((x) => x !== p.category));
      }
    } else {
      const sep = reason.trim() ? "\n\n" : "";
      setReason((reason.trim() ? reason.trim() + sep : "") + p.text);
      setCategories((prev) =>
        prev.includes(p.category) ? prev : [...prev, p.category],
      );
    }
  }

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      toast("Le motif doit faire au moins 5 caractères.", "error");
      return;
    }
    start(async () => {
      const res = await fetch(`/api/admin/properties/${propertyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "rejected",
          rejection_reason: encodeRejection(
            categories.length > 0 ? categories : (["general"] as RejectionCategory[]),
            trimmed,
            // "focused" only makes sense when there's at least one
            // specific section tagged — "general" + focused would
            // leave the seller with an empty form.
            categories.length > 0 ? mode : "full",
          ),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast(j.detail ?? j.error ?? `Échec (${res.status}).`, "error");
        return;
      }
      toast("Annonce refusée. Le vendeur a été notifié.", "warning");
      router.replace("/admin/properties?status=rejected");
    });
  }

  return (
    <div className="space-y-5">
      <section>
        <label className="batta-eyebrow text-[10px]">
          Motif <span className="text-[var(--danger)]">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex. Photos floues — merci de reprendre des clichés nets, plein jour."
          rows={8}
          maxLength={1500}
          autoFocus
          className="mt-1.5 w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-[13.5px] leading-relaxed text-foreground placeholder:text-muted focus:border-[var(--gold)] focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/40"
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
          <span>Le vendeur lit ce message et pourra corriger uniquement les sections marquées.</span>
          <span className="tabular-nums">{reason.length} / 1500</span>
        </div>
      </section>

      <section>
        <h3 className="batta-eyebrow text-[10px]">
          Motifs fréquents <span className="text-muted">· cliquez pour ajouter / retirer</span>
        </h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = reason.includes(p.text);
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => togglePreset(p)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ring-1 transition ${
                  active
                    ? "bg-[var(--gold-faint)] text-[var(--gold-bright)] ring-[var(--gold)]/40"
                    : "bg-surface-2 text-foreground ring-border hover:bg-surface-3 hover:ring-[var(--gold)]/40"
                }`}
              >
                {active && <Check className="size-3" strokeWidth={3} />}
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10.5px] text-muted">
          Empilez plusieurs motifs si l'annonce a plusieurs problèmes — le vendeur verra chaque section à corriger surlignée.
        </p>
      </section>

      <section>
        <h3 className="batta-eyebrow text-[10px]">
          Sections à corriger
          {categories.length > 0 && (
            <span className="ms-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--gold)] px-1.5 text-[10px] font-extrabold text-white">
              {categories.length}
            </span>
          )}
        </h3>
        <p className="mt-1 text-[11px] text-muted">
          Choisissez une ou plusieurs sections. Les motifs fréquents les ajoutent automatiquement.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(Object.keys(REJECTION_CATEGORY_LABELS) as RejectionCategory[]).map((c) => {
            const active = categories.includes(c);
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCategory(c)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
                  active
                    ? "bg-[var(--gold)] text-white ring-[var(--gold)]"
                    : "bg-surface-2 text-muted ring-border hover:ring-[var(--gold)]/40 hover:text-foreground"
                }`}
              >
                {active && <Check className="size-3" strokeWidth={3} />}
                {REJECTION_CATEGORY_LABELS[c]}
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="batta-eyebrow text-[10px]">Affichage côté vendeur</h3>
        <p className="mt-1 text-[11px] text-muted">
          Le vendeur ne re-marche pas tout le formulaire pour une seule retouche.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <ModeOption
            active={mode === "focused"}
            onClick={() => setMode("focused")}
            Icon={EyeOff}
            label="Sections refusées seulement"
            sub="Le vendeur ne voit que les blocs marqués. Recommandé."
            disabled={categories.length === 0}
            disabledHint="Cochez d'abord une section ci-dessus."
          />
          <ModeOption
            active={mode === "full" || categories.length === 0}
            onClick={() => setMode("full")}
            Icon={Eye}
            label="Annonce complète"
            sub="Tout le formulaire est visible, les sections marquées sont surlignées."
          />
        </div>
      </section>

      <div className="sticky bottom-3 z-10 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Link
          href={`/admin/properties/${propertyId}` as `/admin/properties/${string}`}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-border bg-surface-2 px-5 text-[13px] font-semibold text-foreground hover:bg-surface-3"
        >
          <ArrowLeft className="size-3.5" /> Annuler
        </Link>
        <button
          type="button"
          disabled={pending || reason.trim().length < 5}
          onClick={submit}
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-[var(--danger)] px-5 text-[13px] font-bold text-white shadow-[0_10px_30px_-12px_rgba(220,38,38,0.45)] transition hover:bg-[var(--accent-deep)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" strokeWidth={2.5} />}
          Refuser et notifier
        </button>
      </div>
    </div>
  );
}

function ModeOption({
  active, onClick, Icon, label, sub, disabled, disabledHint,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  sub: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-2xl border p-3 text-start transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-[var(--gold)] bg-[var(--gold-faint)] ring-1 ring-[var(--gold)]"
          : "border-border bg-surface hover:border-[var(--gold)]/40"
      }`}
    >
      <span
        className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${
          active ? "bg-[var(--gold)] text-white" : "bg-surface-2 text-[var(--gold)] ring-1 ring-border"
        }`}
      >
        <Icon className="size-4" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-foreground">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted">
          {disabled && disabledHint ? disabledHint : sub}
        </span>
      </span>
    </button>
  );
}
