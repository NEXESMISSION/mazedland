import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { usablePayeeMethods } from "@/lib/payments";
import { SettingsForm, type SettingsValues } from "./SettingsForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Réglages — the payee details sellers pay listing fees to.
 *
 * WHAT WAS REMOVED. This page also configured an auction listing fee, a direct
 * listing fee, three promo prices and durations, a bidding caution, auction
 * formats, an anti-snipe window and the winner's payment delay. Not one of
 * them was read anywhere: auctions are retired, and listing fees and promotions
 * are priced by the PRODUCTS catalogue (/admin/offres) through
 * `lib/products.ts`. An admin changing a fee here saw « Réglages enregistrés »
 * and nothing on the site moved — the worst kind of setting there is.
 */
const KEYS = ["payee_name", "payee_bank", "payee_rib", "payee_iban", "payee_d17"] as const;

export default async function AdminSettingsPage() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", KEYS as unknown as string[]);

  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key as string, row.value);

  const initial: SettingsValues = {
    payee_name: strFrom(map.get("payee_name")),
    payee_bank: strFrom(map.get("payee_bank")),
    payee_rib: strFrom(map.get("payee_rib")),
    payee_iban: strFrom(map.get("payee_iban")),
    payee_d17: strFrom(map.get("payee_d17")),
  };

  const usable = usablePayeeMethods({
    name: initial.payee_name,
    bank: initial.payee_bank,
    rib: initial.payee_rib,
    iban: initial.payee_iban,
    d17: initial.payee_d17,
  });

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader
        eyebrow="Paiement"
        title="Réglages"
        description="Les coordonnées vers lesquelles les vendeurs règlent leurs frais de publication, par virement ou D17."
      />

      {!usable.bank_transfer && !usable.d17 && (
        <div className="mt-5 rounded-2xl bg-amber-500/10 p-4 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-500/30">
          <strong>Aucun moyen de paiement valide.</strong> La page de paiement est bloquée tant que
          ces champs sont vides ou contiennent les valeurs d&apos;exemple : un vendeur ne doit jamais
          virer de l&apos;argent vers un compte fictif.
        </div>
      )}

      <p className="mt-4 text-[12.5px] text-muted">
        Les prix des annonces et des options se règlent dans{" "}
        <Link href="/admin/offres" className="font-bold text-foreground underline underline-offset-2">
          Offres
        </Link>
        .
      </p>

      <div className="mt-5">
        <SettingsForm initial={initial} />
      </div>
    </div>
  );
}

function strFrom(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}
