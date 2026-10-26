import { requireAdmin } from "@/lib/admin/session";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { usablePayeeMethods } from "@/lib/payments";
import { settingsFromRows } from "@/lib/settings/server";
import { SETTINGS, SETTING_GROUPS, type SettingKey } from "@/lib/settings/registry";
import { SettingsPanel } from "./SettingsPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Group = (typeof SETTING_GROUPS)[number];

/**
 * Réglages — everything an admin can change without a deploy, one tab per
 * part of the site, from the registry (src/lib/settings/registry.ts). The
 * first tab is the switch board: each feature on or off, with a link to the
 * console page that manages it.
 *
 * WHAT WAS REMOVED, long ago. This page once configured auction fees, promo
 * prices and a bidding caution that nothing read: an admin changing one saw
 * « Réglages enregistrés » and nothing on the site moved. Every setting here
 * is read by the code (the registry is the list the code reads from).
 */
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const group: Group = (SETTING_GROUPS as readonly string[]).includes(sp.g ?? "") ? (sp.g as Group) : "features";
  const t = await getTranslations("adminSettings");
  const tr = await getTranslations("settingsRegistry");

  const admin = getServiceSupabase();
  const { data } = admin
    ? await admin.from("app_settings").select("key, value").in("key", Object.keys(SETTINGS))
    : { data: [] };
  const rows = (data ?? []) as { key: string; value: unknown }[];
  const values = settingsFromRows(rows);
  const keys = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].group === group);

  // The payee check reads the stored values themselves: the seed's
  // placeholders count as « not set ».
  const raw = new Map(rows.map((r) => [r.key, typeof r.value === "string" ? r.value : ""]));
  const usable = usablePayeeMethods({
    name: raw.get("payee_name") ?? "",
    bank: raw.get("payee_bank") ?? "",
    rib: raw.get("payee_rib") ?? "",
    iban: raw.get("payee_iban") ?? "",
    d17: raw.get("payee_d17") ?? "",
  });

  return (
    <div>
      <SiteTabs />
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("title")} description={t("description")} />

      <nav
        aria-label={tr("ui.tabsLabel")}
        className="-mx-5 mt-4 flex items-center gap-4 overflow-x-auto border-b border-border px-5 lg:-mx-8 lg:px-8"
      >
        {SETTING_GROUPS.map((g) => (
          <Link
            key={g}
            href={`/admin/settings?g=${g}` as "/admin/settings"}
            aria-current={g === group ? "page" : undefined}
            className={`relative shrink-0 py-2.5 text-[12.5px] transition ${
              g === group
                ? "font-semibold text-[var(--gold)] after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-[var(--gold)]"
                : "font-medium text-subtle hover:text-foreground"
            }`}
          >
            {tr(`groups.${g}.title`)}
          </Link>
        ))}
      </nav>

      <p className="mt-4 text-[12.5px] leading-relaxed text-muted">{tr(`groups.${group}.hint`)}</p>

      {group === "payment" && !usable.bank_transfer && !usable.d17 && (
        <div className="mt-4 rounded-2xl bg-amber-500/10 p-4 text-[13px] leading-relaxed text-amber-900 ring-1 ring-amber-500/30">
          {t.rich("noPayeeMethod", { strong: (chunks) => <strong>{chunks}</strong> })}
        </div>
      )}
      {(group === "payment" || group === "publication") && (
        <p className="mt-3 text-[12.5px] text-muted">
          {t.rich("pricesLink", {
            link: (chunks) => (
              <Link href="/admin/offres" className="font-bold text-foreground underline underline-offset-2">
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      <div className="mt-5">
        {/* Keyed by group: switching tabs starts a fresh form. */}
        <SettingsPanel
          key={group}
          keys={keys}
          values={Object.fromEntries(keys.map((k) => [k, values[k]]))}
          stored={rows.map((r) => r.key).filter((k) => keys.includes(k as SettingKey))}
        />
      </div>
    </div>
  );
}
