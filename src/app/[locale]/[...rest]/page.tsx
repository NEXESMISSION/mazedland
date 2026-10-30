import { notFound } from "next/navigation";

/**
 * Any path under a locale that no page claims — /ar/nope, /fr/ancienne-page —
 * lands here, and lands in the locale's own « page introuvable ». Without this
 * catch-all the App Router answered those URLs with the root not-found page
 * (src/app/not-found.tsx): French first, left to right, « Accueil » — on the
 * Arabic site too.
 */
/**
 * Thrown here, before the first byte: the segment streams under
 * src/app/[locale]/loading.tsx, so a notFound() in the page body arrived after
 * a 200 shell — a soft 404 for every unknown URL (the QA tour). Metadata is
 * awaited before streaming for every client (htmlLimitedBots in next.config).
 */
export async function generateMetadata() {
  notFound();
}

export default function CatchAllPage() {
  notFound();
}
