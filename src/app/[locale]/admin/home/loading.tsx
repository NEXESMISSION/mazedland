import { AdminTableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AdminTableSkeleton rows={4} tiles={3} tabs={0} columns={4} />;
}
