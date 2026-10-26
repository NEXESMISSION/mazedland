"use client";

import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Loader2 } from "lucide-react";

/**
 * "Something is happening" — the missing half of every admin navigation.
 *
 * Every admin route is `force-dynamic`, so a click is a full server render:
 * the identity check, then the page's own queries, then the HTML. Even after
 * cutting that down it is a few hundred milliseconds, and for all of it the
 * old page just sat there. Nothing moved, so the natural read was that the
 * click had not registered — and the natural response was to click again,
 * which queues a second render and makes it worse.
 *
 * `useLinkStatus` reports the pending state of the enclosing `<Link>`, so the
 * row or nav item that was clicked can say so itself. It has to be a separate
 * client component because the thing it lives inside — a `DataTable` row, a
 * rail item — is server-rendered.
 */

/** Trailing affordance on a table row: chevron at rest, spinner in flight. */
export function RowChevron() {
  const { pending } = useLinkStatus();
  const t = useTranslations("admin");
  return pending ? (
    <Loader2
      aria-label={t("loading")}
      className="size-4 animate-spin self-center text-gold"
    />
  ) : (
    <ChevronRight
      aria-hidden
      className="size-4 self-center text-subtle transition group-hover:text-gold rtl:-scale-x-100"
      strokeWidth={2}
    />
  );
}

/**
 * Nav-rail icon: swaps to a spinner while its destination loads, so the item
 * you clicked is the thing that shows it is working.
 */
export function NavIcon({
  Icon,
  active,
  /** "inherit" lets the icon take the link's own colour — used by the Site
   *  tabs, where the active state is gold text rather than a filled row. */
  tone = "auto",
  size = "size-4",
}: {
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  active: boolean;
  tone?: "auto" | "inherit";
  size?: string;
}) {
  const { pending } = useLinkStatus();
  const t = useTranslations("admin");
  const colour =
    tone === "inherit" ? "text-current" : active ? "text-[var(--gold)]" : "text-subtle";
  if (pending) {
    return (
      <Loader2
        aria-label={t("loading")}
        className={`${size} shrink-0 animate-spin ${tone === "inherit" ? "text-current" : "text-[var(--gold)]"}`}
      />
    );
  }
  return <Icon className={`${size} shrink-0 ${colour}`} strokeWidth={2} />;
}
