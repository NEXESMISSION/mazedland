import { FormPageSkeleton } from "@/components/ui/Skeleton";

/**
 * Settings is a form, not a table — fees / promo pricing / deposit /
 * payee details. Each section is a separate card.
 */
export default function Loading() {
  return <FormPageSkeleton sections={5} fieldsPerSection={3} />;
}
