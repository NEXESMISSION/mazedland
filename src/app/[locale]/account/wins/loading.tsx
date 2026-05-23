import { ListRowsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListRowsSkeleton rows={4} tabs={0} withThumb />;
}
