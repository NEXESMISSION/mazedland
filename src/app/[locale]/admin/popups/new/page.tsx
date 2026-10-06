import { getTranslations } from "next-intl/server";
import { PopupForm } from "../PopupForm";

export const dynamic = "force-dynamic";

/**
 * /admin/popups/new — blank form. Auth is enforced by the admin layout.
 */
export default async function NewPopupPage() {
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
