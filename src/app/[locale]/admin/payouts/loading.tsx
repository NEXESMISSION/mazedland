import { AdminTableSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AdminTableSkeleton rows={5} tiles={3} tabs={3} columns={6} />;
}
