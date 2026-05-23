import { ListRowsSkeleton } from "@/components/ui/Skeleton";

/**
 * Partner cockpit — list of partner-attributed properties + payouts.
 */
export default function Loading() {
  return <ListRowsSkeleton rows={6} tabs={3} withThumb />;
}
