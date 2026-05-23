import { AdminTableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AdminTableSkeleton rows={6} tiles={3} tabs={4} columns={6} />;
}
