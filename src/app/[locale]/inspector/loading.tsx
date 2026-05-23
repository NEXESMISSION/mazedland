import { ListRowsSkeleton } from "@/components/ui/Skeleton";

/**
 * Inspector dashboard — queue of assigned bookings, list-row style.
 */
export default function Loading() {
  return <ListRowsSkeleton rows={5} tabs={3} withThumb />;
}
