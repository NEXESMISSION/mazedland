import { requireAdmin } from "@/lib/admin/session";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Ltr } from "@/components/ui/Ltr";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Popup } from "@/lib/popups/schema";
import { PopupForm } from "../../PopupForm";

export const dynamic = "force-dynamic";

/**
 * /admin/popups/[id]/edit — fetch the row server-side, render the form
 * with `initial` so the create/update branch can be inferred. 404 if
 * the id isn't a popup the caller can see (RLS combined with the row
 * existing).
 */
/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminPopups");
  return { title: t("editTitle") };
}

export default async function EditPopupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin("popups");
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("popups")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) notFound();
  const popup = data as Popup;
  const t = await getTranslations("adminPopups");

  return (
    <div>
      <span className="mazed-eyebrow">{t("eyebrow")}</span>
      <h2 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        {t("editTitle")}
      </h2>
      <p className="mt-1.5 text-[12px] text-muted">
        {t.rich("slugLine", {
          slug: popup.slug,
          mono: (chunks) => <Ltr className="mazed-tabular font-mono">{chunks}</Ltr>,
        })}
      </p>
      <div className="mt-5">
        <PopupForm initial={popup} />
      </div>
    </div>
  );
}
