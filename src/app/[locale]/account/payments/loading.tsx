import { ListRowsSkeleton } from "@/components/ui/Skeleton";

/**
 * Payment rows lead with a kind badge + amount column rather than a
 * cover photo — drop the thumbnail.
 */
export default function Loading() {
  return <ListRowsSkeleton rows={5} tabs={0} withThumb={false} />;
}
