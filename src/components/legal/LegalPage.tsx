import { Link } from "@/i18n/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * Shared shell for the standalone legal/info pages (/terms, /privacy,
 * /contact). Centered readable column + back link, consistent with the
 * rest of the app's surfaces.
 */
export function LegalPage({
  eyebrow,
  title,
  updated,
  children,
}: {
  eyebrow: string;
  title: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[var(--max-w)] px-5 py-6 lg:max-w-[var(--max-w-content)] lg:py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted transition hover:text-gold-bright"
      >
        <ChevronLeft className="size-4" /> Accueil
      </Link>
      <span className="batta-eyebrow mt-5 block">{eyebrow}</span>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight lg:text-[30px]">
        {title}
      </h1>
      {updated && (
        <p className="mt-1 text-[12px] text-muted">Dernière mise à jour : {updated}</p>
      )}
      <div className="mt-6 rounded-2xl bg-surface p-5 ring-1 ring-border lg:p-7">
        {children}
      </div>
    </div>
  );
}
