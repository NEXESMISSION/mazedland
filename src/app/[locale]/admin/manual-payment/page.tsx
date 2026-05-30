import { getServerSupabase } from "@/lib/supabase/server";
import { parseMonetizationSettings } from "@/lib/pricing";
import { ManualPaymentForm } from "./ManualPaymentForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminManualPaymentPage() {
  const supabase = await getServerSupabase();
  // Deposit config drives the suggested caution amount in the form.
  const { data } = await supabase
    .from("app_settings").select("key, value").eq("key", "deposit").maybeSingle();
  const mon = parseMonetizationSettings(new Map([["deposit", data?.value]]));

  return (
    <div className="max-w-[640px]">
      <span className="batta-eyebrow">Argent · Encaissement</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Paiement manuel — espèces
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Enregistrez un paiement reçu hors ligne (espèces, chèque, virement). Le
        système le traite comme un paiement validé : la caution donne l&apos;entrée
        à l&apos;enchère, l&apos;achat immédiat clôture la vente, etc.
      </p>

      <div className="mt-5">
        <ManualPaymentForm deposit={mon.deposit} />
      </div>
    </div>
  );
}
