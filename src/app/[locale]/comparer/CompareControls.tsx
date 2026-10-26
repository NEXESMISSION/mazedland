"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { useCompare } from "@/components/compare/compareStore";

/**
 * A comparison opened from a link becomes this browser's selection, so the
 * toggles on the annonces agree with what is on screen.
 */
export function CompareSync({ ids }: { ids: string[] }) {
  const { ids: picked, clear, toggle } = useCompare();
  const key = ids.join(",");
  useEffect(() => {
    if (picked.join(",") === key) return;
    clear();
    for (const id of key ? key.split(",") : []) toggle(id);
    // Only when the page's own list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/** Takes one annonce out, here and in the address. */
export function RemoveFromCompare({ id, ids }: { id: string; ids: string[] }) {
  const t = useTranslations("compare");
  const router = useRouter();
  const { remove } = useCompare();
  return (
    <button
      type="button"
      onClick={() => {
        remove(id);
        router.replace(`/comparer?ids=${ids.filter((x) => x !== id).join(",")}` as never);
      }}
      className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-bold text-muted hover:text-foreground"
    >
      <X className="size-3.5" /> {t("removeShort")}
    </button>
  );
}
