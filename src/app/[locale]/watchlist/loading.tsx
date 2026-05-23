import { ListRowsSkeleton } from "@/components/ui/Skeleton";

/**
 * /watchlist redirects to /account/activity?tab=favoris but while
 * that redirect resolves, paint the activity-page shape so the eye
 * doesn't flick between two layouts.
 */
export default function Loading() {
  return <ListRowsSkeleton rows={4} tabs={5} withThumb />;
}
