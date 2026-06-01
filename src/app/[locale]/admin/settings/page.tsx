import { getServerSupabase } from "@/lib/supabase/server";
import { parseMonetizationSettings, parseAntiSnipe } from "@/lib/pricing";
import { SettingsForm, type SettingsValues } from "./SettingsForm";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = [
  "fee_listing_auction",
  "fee_listing_direct",
  "promo_home",
  "promo_top",
  "promo_banner",
  "deposit",
  "auction_antisnipe",
  "payee_name",
  "payee_bank",
  "payee_rib",
  "payee_iban",
  "payee_d17",
] as const;

export default async function AdminSettingsPage() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", KEYS as unknown as string[]);

  const map = new Map<string, unknown>();
  for (const row of data ?? []) map.set(row.key as string, row.value);

  const mon = parseMonetizationSettings(map);
  const antiSnipe = parseAntiSnipe(map.get("auction_antisnipe"));

  const initial: SettingsValues = {
    // Auctions are restricted to free/fixed (no price at posting time).
    feeListingAuction: {
      mode: mon.feeListingAuction.mode === "percent" ? "fixed" : mon.feeListingAuction.mode,
      value: mon.feeListingAuction.value,
    },
    feeListingDirect: mon.feeListingDirect,
    promoHome: mon.promoHome,
    promoTop: mon.promoTop,
    promoBanner: mon.promoBanner,
    deposit: {
      mode: mon.deposit.mode,
      value: mon.deposit.value,
      // <input type=date> wants YYYY-MM-DD.
      free_until: mon.deposit.free_until ? mon.deposit.free_until.slice(0, 10) : "",
    },
    antiSnipe: { window_min: antiSnipe.windowMin, extend_min: antiSnipe.extendMin },
    payee_name: strFrom(map.get("payee_name")),
    payee_bank: strFrom(map.get("payee_bank")),
    payee_rib: strFrom(map.get("payee_rib")),
    payee_iban: strFrom(map.get("payee_iban")),
    payee_d17: strFrom(map.get("payee_d17")),
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow="Monétisation & paiement"
        title="Réglages"
        description="Contrôlez ce que les vendeurs paient pour publier, les options, et la caution pour enchérir — gratuit, montant fixe ou pourcentage. Modifiable à tout moment."
      />

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
