import { ListRowsSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <ListRowsSkeleton rows={6} tabs={3} withThumb />;
}
