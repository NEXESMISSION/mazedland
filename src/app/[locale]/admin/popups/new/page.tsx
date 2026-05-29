import { PopupForm } from "../PopupForm";

export const dynamic = "force-dynamic";

/**
 * /admin/popups/new — blank form. Auth is enforced by the admin layout.
 */
export default function NewPopupPage() {
  return (
    <div>
      <span className="batta-eyebrow">Diffusion</span>
      <h2 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        Nouveau popup
      </h2>
      <p className="mt-1.5 text-[12px] text-muted">
        Configurez ce que les utilisateurs verront, à qui, sur quelles pages et quand.
      </p>
      <div className="mt-5">
        <PopupForm initial={null} />
      </div>
    </div>
  );
}
