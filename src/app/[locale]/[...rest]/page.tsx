import { notFound } from "next/navigation";

/**
 * Any path under a locale that no page claims — /ar/nope, /fr/ancienne-page —
 * lands here, and lands in the locale's own « page introuvable ». Without this
 * catch-all the App Router answered those URLs with the root not-found page
 * (src/app/not-found.tsx): French first, left to right, « Accueil » — on the
 * Arabic site too.
 */
export default function CatchAllPage() {
  notFound();
}
