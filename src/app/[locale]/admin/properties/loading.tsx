import { AdminTableSkeleton } from "@/components/ui/Skeleton";

/**
 * /admin/properties has the broadest table — 8 columns (cover,
 * title, owner, type, price, status, listed, actions) and 5 filter
 * tabs (À valider, Refusées, Validées, Vendues, Toutes). 4 summary
 * tiles up top for the cross-queue KPIs.
 */
export default function Loading() {
  return <AdminTableSkeleton rows={8} tiles={4} tabs={5} columns={8} />;
}
