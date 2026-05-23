import { ListRowsSkeleton } from "@/components/ui/Skeleton";

/**
 * /account/activity ships a 5-tab nav (En cours, En attente, Gagnées,
 * Participées, Favoris) plus a vertical list of cover + title +
 * status-chip rows. Tabs=5 prevents the layout from jumping when the
 * real tab strip mounts.
 */
export default function Loading() {
  return <ListRowsSkeleton rows={6} tabs={5} withThumb />;
}
