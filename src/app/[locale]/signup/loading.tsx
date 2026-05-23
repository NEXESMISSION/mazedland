import { AuthFormSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AuthFormSkeleton fields={3} withFooter />;
}
