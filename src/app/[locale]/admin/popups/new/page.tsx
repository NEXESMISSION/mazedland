import { requireAdmin } from "@/lib/admin/session";
import { getTranslations } from "next-intl/server";
import { PopupForm } from "../PopupForm";

export const dynamic = "force-dynamic";

/**
 * /admin/popups/new — blank form. Auth is enforced by the admin layout.
 */
/** The tab's title: every page of this section used to carry the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("adminPopups");
  return { title: t("title") };
}

export default async function NewPopupPage() {
  await requireAdmin("popups");
  const t = await getTranslations("adminPopups");
  return (
    <div>
      <span className="mazed-eyebrow">{t("eyebrow")}</span>
      <h2 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        {t("newPopup")}
      </h2>
      <p className="mt-1.5 text-[12px] text-muted">{t("newSubtitle")}</p>
      <div className="mt-5">
        <PopupForm initial={null} />
      </div>
    </div>
  );
}
