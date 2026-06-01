import { getServerSupabase } from "@/lib/supabase/server";
import { parseMonetizationSettings } from "@/lib/pricing";
import { ManualPaymentForm } from "./ManualPaymentForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

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
      <AdminPageHeader
        eyebrow="Argent · Encaissement"
        title="Paiement manuel — espèces"
        description={
          <>
            Enregistrez un paiement reçu hors ligne (espèces, chèque, virement). Le
            système le traite comme un paiement validé : la caution donne l&apos;entrée
            à l&apos;enchère, l&apos;achat immédiat clôture la vente, etc.
          </>
        }
      />

      <div className="mt-5">
        <ManualPaymentForm deposit={mon.deposit} />
      </div>
    </div>
  );
}
