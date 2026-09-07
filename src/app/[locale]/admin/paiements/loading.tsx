/**
 * Loading boundary for this segment.
 *
 * The App Router commits a navigation immediately only when a boundary exists
 * inside the subtree that is changing. `[locale]/loading.tsx` sits above every
 * page, so it fires once on entering the locale and never again — which left
 * every page-to-page click waiting on a full server render with nothing on
 * screen moving. One file per segment is what makes the click land instantly.
 */
import { ConsoleSkeleton } from "@/components/ui/PageSkeleton";

export default function Loading() {
  return <ConsoleSkeleton rows={10} />;
}
