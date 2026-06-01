import { getServerSupabase } from "@/lib/supabase/server";
import type { PropertyType } from "@/lib/types";
import { LegalDocsEditor, type LegalDocKindRow } from "./LegalDocsEditor";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

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
  for (const t of PROPERTY_TYPES) byType.set(t, []);
  for (const row of (data ?? []) as LegalDocKindRow[]) {
    byType.get(row.property_type)?.push(row);
  }

  const initial = Object.fromEntries(
    PROPERTY_TYPES.map((t) => [t, byType.get(t) ?? []]),
  ) as Record<PropertyType, LegalDocKindRow[]>;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Documents légaux"
        title="Catalogue par type de bien"
        description={
          <>
            Définissez la liste des documents que chaque vendeur doit téléverser
            selon le type de bien. Les documents marqués <b>requis</b> bloquent
            l&apos;envoi du formulaire tant qu&apos;ils ne sont pas fournis.
          </>
        }
      />

      <div className="mt-5">
        <LegalDocsEditor initial={initial} />
      </div>
    </div>
  );
}
