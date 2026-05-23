import { AdminTableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AdminTableSkeleton rows={5} tiles={0} tabs={4} columns={5} />;
}
