import { getServerSupabase } from "@/lib/supabase/server";
import { SettingsForm, type SettingsValues } from "./SettingsForm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = [
  "listing_fee_tnd",
  "promo_home_featured_tnd",
  "promo_top_listed_tnd",
  "promo_banner_tnd",
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
    .select("key, value, description")
    .in("key", KEYS as unknown as string[]);

  const map = new Map<string, { value: unknown; description: string | null }>();
  for (const row of data ?? []) {
    map.set(row.key as string, {
      value: row.value,
      description: (row as { description?: string }).description ?? null,
    });
  }

  const initial: SettingsValues = {
    listing_fee_tnd: numFrom(map.get("listing_fee_tnd")?.value, 20),
    promo_home_featured_tnd: numFrom(map.get("promo_home_featured_tnd")?.value, 15),
    promo_top_listed_tnd: numFrom(map.get("promo_top_listed_tnd")?.value, 10),
    promo_banner_tnd: numFrom(map.get("promo_banner_tnd")?.value, 30),
    payee_name: strFrom(map.get("payee_name")?.value, ""),
    payee_bank: strFrom(map.get("payee_bank")?.value, ""),
    payee_rib: strFrom(map.get("payee_rib")?.value, ""),
    payee_iban: strFrom(map.get("payee_iban")?.value, ""),
    payee_d17: strFrom(map.get("payee_d17")?.value, ""),
  };

  return (
    <div>
      <span className="batta-eyebrow">Pricing &amp; payee</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Réglages
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Frais d&apos;annonce et options promotionnelles. Les coordonnées
        bancaires sont affichées au vendeur au moment du paiement.
      </p>

      <div className="mt-5">
        <SettingsForm initial={initial} />
      </div>
    </div>
  );
}

function numFrom(v: unknown, fallback: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
function strFrom(v: unknown, fallback: string): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  return String(v);
}
