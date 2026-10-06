import { getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import type { PropertyType } from "@/lib/types";
import { LegalDocsEditor, type LegalDocKindRow } from "./LegalDocsEditor";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { SiteTabs } from "@/components/admin/kit/SiteTabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROPERTY_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

export default async function AdminLegalDocsPage() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("legal_doc_kinds")
    .select("id, property_type, label, description, required, sort_order")
    .order("property_type")
    .order("sort_order")
    .order("label");

  const byType = new Map<PropertyType, LegalDocKindRow[]>();
  for (const pt of PROPERTY_TYPES) byType.set(pt, []);
  for (const row of (data ?? []) as LegalDocKindRow[]) {
    byType.get(row.property_type)?.push(row);
  }

  const initial = Object.fromEntries(
    PROPERTY_TYPES.map((pt) => [pt, byType.get(pt) ?? []]),
  ) as Record<PropertyType, LegalDocKindRow[]>;

  const t = await getTranslations("adminLegalDocs");

  // Document labels and descriptions are shown as stored: they are French
  // content an admin wrote, not interface text.
  return (
    <div>
      <SiteTabs />
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t.rich("description", { b: (chunks) => <b>{chunks}</b> })}
      />

      <div className="mt-5">
        <LegalDocsEditor initial={initial} />
      </div>
    </div>
  );
}
