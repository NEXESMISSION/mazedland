import { HeroWithGridSkeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return <HeroWithGridSkeleton cards={3} cols={3} />;
}
