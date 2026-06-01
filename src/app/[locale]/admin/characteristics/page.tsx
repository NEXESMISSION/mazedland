import { getServerSupabase } from "@/lib/supabase/server";
import type { PropertyType, AttributeKind } from "@/lib/types";
import { CharacteristicsEditor } from "./CharacteristicsEditor";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROPERTY_TYPES: PropertyType[] = [
  "apartment", "house", "villa", "land",
  "commercial", "office", "warehouse", "farm",
];

export default async function AdminCharacteristicsPage() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("property_attribute_kinds")
    .select("id, property_type, field_key, label, data_type, options, unit, required, sort_order")
    .order("property_type")
    .order("sort_order")
    .order("label");

  const byType = new Map<PropertyType, AttributeKind[]>();
  for (const t of PROPERTY_TYPES) byType.set(t, []);
  for (const row of (data ?? []) as AttributeKind[]) {
    byType.get(row.property_type)?.push(row);
  }

  const initial = Object.fromEntries(
    PROPERTY_TYPES.map((t) => [t, byType.get(t) ?? []]),
  ) as Record<PropertyType, AttributeKind[]>;

  return (
    <div>
      <AdminPageHeader
        eyebrow="Caractéristiques"
        title="Champs par type de bien"
        description={
          <>
            Définissez les caractéristiques que chaque vendeur renseigne selon le
            type de bien (surface, pièces, type de titre, source d&apos;eau…). Les
            champs marqués <b>requis</b> bloquent l&apos;envoi du formulaire. Ces
            informations apparaissent sur la fiche publique du bien.
          </>
        }
      />

      <div className="mt-5">
        <CharacteristicsEditor initial={initial} />
      </div>
    </div>
  );
}
