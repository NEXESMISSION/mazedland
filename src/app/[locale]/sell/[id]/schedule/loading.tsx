import { FormPageSkeleton } from "@/components/ui/Skeleton";

/**
 * ScheduleForm: start date, duration, opening price, increment,
 * promo selection — 3 sections.
 */
export default function Loading() {
  return <FormPageSkeleton sections={3} fieldsPerSection={2} />;
}
