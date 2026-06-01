import { ListRowsSkeleton } from "@/components/ui/Skeleton";

/**
 * The remade payments page leads with four summary cards + a filter-tab
 * strip + rows that now carry a cover thumbnail. Mirror that footprint so
 * the loading→content swap doesn't reflow.
 */
export default function Loading() {
  return <ListRowsSkeleton rows={5} tabs={5} withThumb cards={4} />;
}
