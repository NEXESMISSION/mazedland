/**
 * Login skeleton — mirrors the centered brand-logo + 2-field form
 * layout so the auth screen never blinks blank. Reused via the same
 * footprint by /signup, /forgot-password, /reset-password (each has
 * its own loading.tsx pointing at AuthFormSkeleton with the right
 * field count).
 */
import { AuthFormSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <AuthFormSkeleton fields={2} withFooter />;
}
