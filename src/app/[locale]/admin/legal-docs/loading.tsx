import { AdminTableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AdminTableSkeleton rows={5} tiles={0} tabs={0} columns={4} />;
}
