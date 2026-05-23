import { FormPageSkeleton } from "@/components/ui/Skeleton";

/**
 * SellForm is the longest form in the app — 6 sections covering
 * identity, location, characteristics, photos, documents, monetization.
 */
export default function Loading() {
  return <FormPageSkeleton sections={6} fieldsPerSection={3} />;
}
