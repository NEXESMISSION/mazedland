import { notFound } from "next/navigation";
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
export default async function EditPopupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getServerSupabase();
  const { data, error } = await supabase
    .from("popups")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) notFound();
  const popup = data as Popup;

  return (
    <div>
      <span className="batta-eyebrow">Diffusion</span>
      <h2 className="mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight">
        Modifier le popup
      </h2>
      <p className="mt-1.5 text-[12px] text-muted">
        Slug : <span className="batta-tabular font-mono">{popup.slug}</span>
      </p>
      <div className="mt-5">
        <PopupForm initial={popup} />
      </div>
    </div>
  );
}
