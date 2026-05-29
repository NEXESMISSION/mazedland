"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";
import { useToast } from "@/components/ui/Toast";
import type {
  Popup, PopupMode, PopupVariant, PopupAudience,
  PopupFrequency, PopupDevices, PopupStatus, PopupLocale,
} from "@/lib/popups/schema";
import {
  Eye, Save, Trash2, ChevronDown, AlertCircle,
} from "lucide-react";

/**
 * Single form used for both the "new" and "edit" admin routes. Pass
 * `initial` = null to render the create flow; pass a `Popup` row to
 * render the edit flow with the delete + preview affordances enabled.
 *
 * Designed for Phase 1 — only the modal variant renders on the
 * front-end yet, but the form already accepts banner and sheet so
 * admins can pre-load content before the renderers ship.
 */
export function PopupForm({
  initial,
}: {
  initial: Popup | null;
}) {
  const router = useRouter();
  const { toast } = useToast();

  // ── Top-level fields ────────────────────────────────────────────────
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [mode, setMode] = useState<PopupMode>(initial?.mode ?? "broadcast");
  const [variant, setVariant] = useState<PopupVariant>(initial?.variant ?? "modal");
  const [status, setStatus] = useState<PopupStatus>(initial?.status ?? "draft");
  const [priority, setPriority] = useState<number>(initial?.priority ?? 0);

  // ── Localised content (fr is required; ar / en optional) ────────────
  const [titleFr, setTitleFr] = useState(initial?.title?.fr ?? "");
  const [titleAr, setTitleAr] = useState(initial?.title?.ar ?? "");
  const [titleEn, setTitleEn] = useState(initial?.title?.en ?? "");
  const [bodyFr, setBodyFr] = useState(initial?.body?.fr ?? "");
  const [bodyAr, setBodyAr] = useState(initial?.body?.ar ?? "");
  const [bodyEn, setBodyEn] = useState(initial?.body?.en ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");

  // ── CTAs ─────────────────────────────────────────────────────────────
  const [ctaPrimaryLabelFr, setCtaPrimaryLabelFr] = useState(initial?.cta_primary?.label?.fr ?? "");
  const [ctaPrimaryHref, setCtaPrimaryHref] = useState(initial?.cta_primary?.href ?? "");
  const [ctaSecondaryLabelFr, setCtaSecondaryLabelFr] = useState(initial?.cta_secondary?.label?.fr ?? "");
  const [ctaSecondaryHref, setCtaSecondaryHref] = useState(initial?.cta_secondary?.href ?? "");

  // ── Audience ─────────────────────────────────────────────────────────
  const initialAudience: PopupAudience = initial?.audience ?? { scope: "all" };
  const [audienceScope, setAudienceScope] = useState<PopupAudience["scope"]>(
    initialAudience.scope,
  );
  const [audienceRoles, setAudienceRoles] = useState<string[]>(
    initialAudience.scope === "logged_in" && initialAudience.roles
      ? initialAudience.roles
      : [],
  );

  // ── Targeting / schedule / frequency ────────────────────────────────
  const [pagesRaw, setPagesRaw] = useState((initial?.pages ?? []).join(", "));
  const [locales, setLocales] = useState<PopupLocale[]>(
    (initial?.locales as PopupLocale[]) ?? ["fr"],
  );
  const [devices, setDevices] = useState<PopupDevices>(initial?.devices ?? "both");
  const [startsAt, setStartsAt] = useState(isoToLocal(initial?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(isoToLocal(initial?.ends_at ?? null));
  const [frequency, setFrequency] = useState<PopupFrequency>(initial?.frequency ?? "once_per_user");
  const [frequencyN, setFrequencyN] = useState<number>(initial?.frequency_n ?? 7);
  const [dismissible, setDismissible] = useState<boolean>(initial?.dismissible ?? true);
  const [forceAction, setForceAction] = useState<boolean>(initial?.force_action ?? false);

  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── Preview state — opens a live render of the popup in a backdrop
  //    overlay. Reuses the same ModalPopup the real PopupManager uses
  //    so what the admin sees is exactly what users will see.
  const [previewOpen, setPreviewOpen] = useState(false);

  const payload = useMemo(() => buildPayload({
    slug, mode, variant, status, priority,
    titleFr, titleAr, titleEn, bodyFr, bodyAr, bodyEn,
    imageUrl, icon,
    ctaPrimaryLabelFr, ctaPrimaryHref,
    ctaSecondaryLabelFr, ctaSecondaryHref,
    audienceScope, audienceRoles,
    pagesRaw, locales, devices,
    startsAt, endsAt, frequency, frequencyN,
    dismissible, forceAction,
  }), [
    slug, mode, variant, status, priority,
    titleFr, titleAr, titleEn, bodyFr, bodyAr, bodyEn,
    imageUrl, icon,
    ctaPrimaryLabelFr, ctaPrimaryHref,
    ctaSecondaryLabelFr, ctaSecondaryHref,
    audienceScope, audienceRoles,
    pagesRaw, locales, devices,
    startsAt, endsAt, frequency, frequencyN,
    dismissible, forceAction,
  ]);

  async function onSave() {
    setError(null);
    startSaving(async () => {
      const url = initial
        ? `/api/admin/popups/${initial.id}`
        : `/api/admin/popups`;
      const method = initial ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        item?: Popup;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "save_failed");
        toast(data.error ?? "Erreur inconnue", "error");
        return;
      }
      toast(initial ? "Popup mis à jour" : "Popup créé", "success");
      router.push("/admin/popups");
      router.refresh();
    });
  }

  async function onDelete() {
    if (!initial) return;
    if (!confirm(`Supprimer définitivement « ${slug} » ?`)) return;
    const res = await fetch(`/api/admin/popups/${initial.id}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast((d as { error?: string }).error ?? "Suppression échouée", "error");
      return;
    }
    toast("Popup supprimé", "success");
    router.push("/admin/popups");
    router.refresh();
  }

  return (
    <div className="pb-24">
      {/* Action bar — sticky so save is always one tap away from any field. */}
      <div className="sticky top-0 z-20 -mx-1 mb-5 flex items-center justify-between gap-3 rounded-2xl bg-background/95 px-2 py-2.5 backdrop-blur">
        <div className="text-[13px] font-bold text-foreground">
          {initial ? "Modifier le popup" : "Nouveau popup"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-2 text-[11.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-gold-soft/50"
          >
            <Eye className="size-4" strokeWidth={2.2} />
            Aperçu
          </button>
          {initial && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3 py-2 text-[11.5px] font-bold text-red-700 ring-1 ring-red-500/30 transition hover:bg-red-500/20"
            >
              <Trash2 className="size-4" strokeWidth={2.2} />
              Supprimer
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="batta-btn-luxe tap-target inline-flex items-center gap-1.5 px-4 py-2 text-[12px] disabled:opacity-50"
          >
            <Save className="size-4" strokeWidth={2.2} />
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-xl bg-red-500/10 px-4 py-3 text-[12.5px] font-semibold text-red-700 ring-1 ring-red-500/30">
          <AlertCircle className="size-4" strokeWidth={2.2} />
          {humanError(error)}
        </div>
      )}

      {/* ─── Identification ──────────────────────────────────────────── */}
      <Section title="Identification" subtitle="Slug court (lettres, chiffres, tirets) — utilisé dans les logs et le localStorage anonyme.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Slug" required>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="ex. welcome-2026 ou kyc-nudge"
              className="batta-input"
            />
          </Field>
          <Field label="Statut">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PopupStatus)}
              className="batta-input"
            >
              <option value="draft">Brouillon</option>
              <option value="live">En ligne</option>
              <option value="paused">En pause</option>
              <option value="archived">Archivé</option>
            </select>
          </Field>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          <Field label="Mode" hint="Diffusion = fenêtre temporelle. Règle = condition permanente.">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PopupMode)}
              className="batta-input"
            >
              <option value="broadcast">Diffusion (one-shot)</option>
              <option value="rule">Règle permanente</option>
            </select>
          </Field>
          <Field label="Variante" hint="V1 ne rend que la modale ; bannière + sheet arrivent en phase 2.">
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value as PopupVariant)}
              className="batta-input"
            >
              <option value="modal">Modale</option>
              <option value="banner">Bannière (à venir)</option>
              <option value="sheet">Bottom sheet (à venir)</option>
            </select>
          </Field>
          <Field label="Priorité" hint="Quand plusieurs popups correspondent, le plus haut gagne.">
            <input
              type="number"
              min={-100}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
              className="batta-input"
            />
          </Field>
        </div>
      </Section>

      {/* ─── Contenu ─────────────────────────────────────────────────── */}
      <Section title="Contenu" subtitle="Titre + corps + image facultative. Le français est requis ; arabe et anglais sont optionnels.">
        <LocalisedInputs
          label="Titre"
          fr={titleFr} setFr={setTitleFr}
          ar={titleAr} setAr={setTitleAr}
          en={titleEn} setEn={setTitleEn}
          required
        />
        <div className="mt-4">
          <LocalisedInputs
            label="Corps"
            fr={bodyFr} setFr={setBodyFr}
            ar={bodyAr} setAr={setBodyAr}
            en={bodyEn} setEn={setBodyEn}
            multiline
          />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="URL de l'image" hint="Optionnel. Affiché en haut de la modale.">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              className="batta-input"
            />
          </Field>
          <Field label="Icône (Lucide)" hint="ex. Sparkles, ShieldCheck — laissé vide = pas d'icône.">
            <input
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              placeholder="Sparkles"
              className="batta-input"
            />
          </Field>
        </div>
      </Section>

      {/* ─── CTAs ────────────────────────────────────────────────────── */}
      <Section title="Boutons d'action" subtitle="Le bouton principal est obligatoire pour que le popup soit actionnable ; le secondaire est optionnel.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Libellé principal (fr)">
            <input
              value={ctaPrimaryLabelFr}
              onChange={(e) => setCtaPrimaryLabelFr(e.target.value)}
              placeholder="Continuer"
              className="batta-input"
            />
          </Field>
          <Field label="Lien principal">
            <input
              value={ctaPrimaryHref}
              onChange={(e) => setCtaPrimaryHref(e.target.value)}
              placeholder="/properties"
              className="batta-input"
            />
          </Field>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="Libellé secondaire (fr) — facultatif">
            <input
              value={ctaSecondaryLabelFr}
              onChange={(e) => setCtaSecondaryLabelFr(e.target.value)}
              placeholder="Plus tard"
              className="batta-input"
            />
          </Field>
          <Field label="Lien secondaire — facultatif">
            <input
              value={ctaSecondaryHref}
              onChange={(e) => setCtaSecondaryHref(e.target.value)}
              placeholder="/help"
              className="batta-input"
            />
          </Field>
        </div>
      </Section>

      {/* ─── Audience ────────────────────────────────────────────────── */}
      <Section title="Audience" subtitle="À qui le popup est-il destiné ?">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Portée">
            <select
              value={audienceScope}
              onChange={(e) => setAudienceScope(e.target.value as PopupAudience["scope"])}
              className="batta-input"
            >
              <option value="all">Tout le monde</option>
              <option value="anon">Visiteurs anonymes</option>
              <option value="logged_in">Utilisateurs connectés</option>
            </select>
          </Field>
          {audienceScope === "logged_in" && (
            <Field label="Rôles (optionnel)" hint="Restreindre à certains rôles. Vide = tous les rôles.">
              <RoleMultiSelect value={audienceRoles} onChange={setAudienceRoles} />
            </Field>
          )}
        </div>
      </Section>

      {/* ─── Ciblage pages / langues / appareils ─────────────────────── */}
      <Section title="Ciblage" subtitle="Les pages où le popup doit s'afficher, sa langue et le type d'appareil.">
        <Field label="Pages" hint='Une glob par ligne ou séparées par des virgules. Vide = toutes les pages. Ex. "/, /auctions/*". Préfixe "!" pour exclure : "!/admin/*".'>
          <input
            value={pagesRaw}
            onChange={(e) => setPagesRaw(e.target.value)}
            placeholder="/, /auctions/*"
            className="batta-input"
          />
        </Field>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="Langues">
            <div className="flex gap-2">
              {(["fr", "ar", "en"] as const).map((l) => (
                <label key={l} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] font-bold ring-1 ring-border cursor-pointer">
                  <input
                    type="checkbox"
                    checked={locales.includes(l)}
                    onChange={(e) => {
                      setLocales((prev) =>
                        e.target.checked ? [...new Set([...prev, l])] : prev.filter((x) => x !== l),
                      );
                    }}
                  />
                  {l.toUpperCase()}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Appareils">
            <select
              value={devices}
              onChange={(e) => setDevices(e.target.value as PopupDevices)}
              className="batta-input"
            >
              <option value="both">Mobile + Desktop</option>
              <option value="mobile">Mobile uniquement</option>
              <option value="desktop">Desktop uniquement</option>
            </select>
          </Field>
        </div>
      </Section>

      {/* ─── Diffusion ────────────────────────────────────────────────── */}
      {mode === "broadcast" && (
        <Section title="Fenêtre de diffusion" subtitle="Dates de début et de fin (UTC).">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="Démarre le">
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="batta-input"
              />
            </Field>
            <Field label="Se termine le">
              <input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="batta-input"
              />
            </Field>
          </div>
        </Section>
      )}

      {/* ─── Fréquence + comportement ────────────────────────────────── */}
      <Section title="Fréquence & comportement" subtitle="À quelle cadence l'utilisateur revoit-il le popup ?">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Fréquence">
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PopupFrequency)}
              className="batta-input"
            >
              <option value="once_per_user">Une fois par utilisateur</option>
              <option value="once_per_session">Une fois par session</option>
              <option value="every_visit">À chaque visite</option>
              <option value="every_n_days">Tous les N jours</option>
            </select>
          </Field>
          {frequency === "every_n_days" && (
            <Field label="N (jours)">
              <input
                type="number"
                min={1}
                max={365}
                value={frequencyN}
                onChange={(e) => setFrequencyN(Math.max(1, Number(e.target.value) || 1))}
                className="batta-input"
              />
            </Field>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
            />
            Fermable par l'utilisateur
          </label>
          <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold">
            <input
              type="checkbox"
              checked={forceAction}
              onChange={(e) => setForceAction(e.target.checked)}
            />
            Bloquer la page jusqu'à action (ex. acceptation CGU)
          </label>
        </div>
      </Section>

      {/* ─── Preview overlay ─────────────────────────────────────────── */}
      {previewOpen && (
        <PreviewOverlay
          onClose={() => setPreviewOpen(false)}
          title={titleFr || "Sans titre"}
          body={bodyFr || ""}
          imageUrl={imageUrl}
          icon={icon}
          ctaPrimary={ctaPrimaryLabelFr && ctaPrimaryHref ? { label: ctaPrimaryLabelFr, href: ctaPrimaryHref } : null}
          ctaSecondary={ctaSecondaryLabelFr && ctaSecondaryHref ? { label: ctaSecondaryLabelFr, href: ctaSecondaryHref } : null}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function buildPayload(s: {
  slug: string; mode: PopupMode; variant: PopupVariant; status: PopupStatus; priority: number;
  titleFr: string; titleAr: string; titleEn: string;
  bodyFr: string; bodyAr: string; bodyEn: string;
  imageUrl: string; icon: string;
  ctaPrimaryLabelFr: string; ctaPrimaryHref: string;
  ctaSecondaryLabelFr: string; ctaSecondaryHref: string;
  audienceScope: PopupAudience["scope"]; audienceRoles: string[];
  pagesRaw: string; locales: PopupLocale[]; devices: PopupDevices;
  startsAt: string; endsAt: string;
  frequency: PopupFrequency; frequencyN: number;
  dismissible: boolean; forceAction: boolean;
}) {
  const audience: Record<string, unknown> =
    s.audienceScope === "all" || s.audienceScope === "anon"
      ? { scope: s.audienceScope }
      : { scope: "logged_in", ...(s.audienceRoles.length > 0 ? { roles: s.audienceRoles } : {}) };

  const pages = s.pagesRaw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);

  return {
    slug: s.slug,
    mode: s.mode,
    variant: s.variant,
    status: s.status,
    priority: s.priority,
    title: pickLocalised(s.titleFr, s.titleAr, s.titleEn),
    body: pickLocalised(s.bodyFr, s.bodyAr, s.bodyEn),
    image_url: s.imageUrl.trim() || null,
    icon: s.icon.trim() || null,
    cta_primary: s.ctaPrimaryLabelFr && s.ctaPrimaryHref ? {
      label: pickLocalised(s.ctaPrimaryLabelFr, "", ""),
      href: s.ctaPrimaryHref,
      tone: "primary",
    } : null,
    cta_secondary: s.ctaSecondaryLabelFr && s.ctaSecondaryHref ? {
      label: pickLocalised(s.ctaSecondaryLabelFr, "", ""),
      href: s.ctaSecondaryHref,
      tone: "secondary",
    } : null,
    audience,
    pages,
    locales: s.locales,
    devices: s.devices,
    starts_at: localToIso(s.startsAt),
    ends_at: localToIso(s.endsAt),
    frequency: s.frequency,
    frequency_n: s.frequency === "every_n_days" ? s.frequencyN : null,
    dismissible: s.dismissible,
    force_action: s.forceAction,
  };
}

function pickLocalised(fr: string, ar: string, en: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (fr.trim()) out.fr = fr.trim();
  if (ar.trim()) out.ar = ar.trim();
  if (en.trim()) out.en = en.trim();
  return out;
}

function isoToLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function humanError(code: string): string {
  switch (code) {
    case "slug_invalid": return "Le slug est invalide (lettres, chiffres, tirets).";
    case "title_required": return "Le titre en français est requis.";
    case "body_invalid": return "Le corps est invalide.";
    case "mode_invalid": return "Mode inconnu.";
    case "variant_invalid": return "Variante inconnue.";
    case "audience_invalid": return "Audience invalide.";
    case "forbidden": return "Accès refusé.";
    case "auth": return "Veuillez vous reconnecter.";
    default: return code;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────

function Section({
  title, subtitle, children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="batta-frame mt-5 p-5">
      <h3 className="text-[14px] font-extrabold leading-tight text-foreground">{title}</h3>
      {subtitle && <p className="mt-1 text-[11.5px] text-muted">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label, hint, required, children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
        {label}
        {required && <span className="text-red-600">*</span>}
      </div>
      {children}
      {hint && <div className="mt-1 text-[10.5px] text-muted">{hint}</div>}
    </label>
  );
}

function LocalisedInputs({
  label, fr, setFr, ar, setAr, en, setEn, required, multiline,
}: {
  label: string;
  fr: string; setFr: (v: string) => void;
  ar: string; setAr: (v: string) => void;
  en: string; setEn: (v: string) => void;
  required?: boolean;
  multiline?: boolean;
}) {
  const [active, setActive] = useState<"fr" | "ar" | "en">("fr");
  const value = active === "fr" ? fr : active === "ar" ? ar : en;
  const setter = active === "fr" ? setFr : active === "ar" ? setAr : setEn;
  const Input = multiline ? "textarea" : "input";
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-muted">
          {label}{required && <span className="text-red-600">*</span>}
        </div>
        <div className="flex gap-1">
          {(["fr", "ar", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setActive(l)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider transition ${
                active === l
                  ? "batta-gold-fill text-foreground"
                  : "bg-surface-2 text-muted hover:text-foreground"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <Input
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
          setter(e.target.value)
        }
        className={`batta-input ${multiline ? "min-h-[100px]" : ""}`}
        placeholder={`Texte en ${active.toUpperCase()}…`}
      />
    </div>
  );
}

function RoleMultiSelect({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const ROLES = [
    { key: "individual", label: "Particuliers" },
    { key: "agency",     label: "Agences" },
    { key: "bank",       label: "Banques" },
    { key: "bailiff",    label: "Huissiers" },
    { key: "inspector",  label: "Inspecteurs" },
    { key: "admin",      label: "Admins" },
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {ROLES.map((r) => {
        const active = value.includes(r.key);
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              onChange(
                active ? value.filter((v) => v !== r.key) : [...value, r.key],
              );
            }}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
              active
                ? "border-[var(--gold)] bg-[var(--gold)] text-white"
                : "border-[var(--border)] bg-surface text-muted hover:border-[var(--gold-soft)] hover:text-[var(--gold)]"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// Lightweight preview overlay — renders the same shapes the real
// ModalPopup uses (gold ring, image, title/body, CTAs) but in an
// admin-only context so it doesn't fire impressions or hit the API.
function PreviewOverlay({
  onClose, title, body, imageUrl, icon, ctaPrimary, ctaSecondary,
}: {
  onClose: () => void;
  title: string;
  body: string;
  imageUrl: string;
  icon: string;
  ctaPrimary: { label: string; href: string } | null;
  ctaSecondary: { label: string; href: string } | null;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-surface ring-1 ring-gold/30 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute end-3 top-3 z-10 rounded-full bg-black/40 px-2 py-1 text-[10px] font-bold text-white"
        >
          Fermer
        </button>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="aspect-[16/9] w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        <div className="p-6 text-center">
          {icon && (
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-wider text-gold">
              {icon}
            </div>
          )}
          <h3 className="text-[18px] font-extrabold leading-tight">{title}</h3>
          {body && (
            <p className="mt-2 whitespace-pre-line text-[13px] text-foreground/80">
              {body}
            </p>
          )}
          {(ctaPrimary || ctaSecondary) && (
            <div className="mt-5 flex flex-col gap-2">
              {ctaPrimary && (
                <span className="batta-btn-luxe tap-target inline-flex w-full items-center justify-center gap-1.5 px-4 py-2.5 text-[12.5px]">
                  {ctaPrimary.label}
                </span>
              )}
              {ctaSecondary && (
                <span className="inline-flex w-full items-center justify-center rounded-full bg-surface-2 px-4 py-2.5 text-[12px] font-bold text-muted ring-1 ring-border">
                  {ctaSecondary.label}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Ensure the underlying ChevronDown import isn't tree-shaken away —
// reserved for the upcoming "advanced audience filters" disclosure.
const _keepalive = ChevronDown;
void _keepalive;
