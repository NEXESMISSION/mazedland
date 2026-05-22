import { getServerSupabase } from "@/lib/supabase/server";
import { parseMonetizationSettings } from "@/lib/pricing";
import { SettingsForm, type SettingsValues } from "./SettingsForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = [
  "fee_listing_auction",
  "fee_listing_direct",
  "promo_home",
  "promo_top",
  "promo_banner",
  "deposit",
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
    payee_name: strFrom(map.get("payee_name")),
    payee_bank: strFrom(map.get("payee_bank")),
    payee_rib: strFrom(map.get("payee_rib")),
    payee_iban: strFrom(map.get("payee_iban")),
    payee_d17: strFrom(map.get("payee_d17")),
  };

  return (
    <div>
      <span className="batta-eyebrow">Monétisation &amp; paiement</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Réglages
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Contrôlez ce que les vendeurs paient pour publier, les options, et la
        caution pour enchérir — gratuit, montant fixe ou pourcentage. Modifiable
        à tout moment.
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
