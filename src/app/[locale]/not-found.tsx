import { Compass, Home } from "lucide-react";

/**
 * Locale-segment 404. Rendered when notFound() fires inside [locale]/* or a
 * user hits an unknown path under a valid locale. Plain <a> to home — the
 * middleware rewrites "/" to the default locale.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-9rem)] max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-gold-faint text-gold ring-1 ring-gold/30">
        <Compass className="size-7" strokeWidth={1.8} />
      </div>
      <h1 className="mt-5 text-[22px] font-extrabold leading-tight tracking-tight">
        Page introuvable
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-[var(--foreground-muted)]">
        Le lien que vous avez suivi n&apos;existe pas ou a été déplacé.
      </p>
      <a
        href="/"
        className="tap-target mt-6 inline-flex h-11 items-center justify-center gap-1.5 rounded-full bg-[var(--gold)] px-6 text-[13px] font-bold text-white shadow-[var(--shadow-gold)] transition-all hover:bg-[var(--gold-bright)] active:scale-[0.98]"
      >
        <Home className="size-4" strokeWidth={2.2} />
        Retour à l&apos;accueil
      </a>
    </div>
  );
}
