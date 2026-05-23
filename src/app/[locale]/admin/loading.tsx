import { AdminTableSkeleton } from "@/components/ui/Skeleton";

/**
 * Catch-all skeleton for any /admin/* subpage that doesn't ship its
 * own loading.tsx. The detailed table-shaped pages (properties,
 * payments, users, etc.) each override this with their own column /
 * tab counts so the swap is invisible.
 */
export default function Loading() {
  return <AdminTableSkeleton rows={6} tiles={4} tabs={3} columns={5} />;
}
