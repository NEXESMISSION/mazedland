import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { BookInspectionForm } from "@/components/inspector/BookInspectionForm";
import { getLocale } from "next-intl/server";

// Per-user, auth-gated — never static (env-less prerender would throw + fail the build).
export const dynamic = "force-dynamic";

export default async function BookInspection({
  searchParams,
  params,
}: {
  searchParams: Promise<{ property?: string }>;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const currentLocale = await getLocale();
  const isRTL = currentLocale === "ar";
  const sp = await searchParams;
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  if (!sp.property) {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 py-10 text-center text-[13px] text-muted">
        Pick a property first.
      </div>
    );
  }

  const { data: property } = await supabase
    .from("properties")
    .select("id, title, governorate")
    .eq("id", sp.property)
    .single();

  if (!property) {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 py-10 text-center text-[13px] text-muted">
        Property not found.
      </div>
    );
  }

  const { data: inspectorRows } = await supabase
    .from("inspectors")
    .select(`id, speciality, rating_avg`)
    .eq("approved", true)
    .contains("governorates", [property.governorate])
    .limit(20);
  // Names from the safe public_profiles view (profiles is self/admin-only since
  // 0080). Batched single round-trip.
  const inspectorIds = (inspectorRows ?? []).map((r) => r.id as string);
  const inspectorNames = new Map<string, string | null>();
  if (inspectorIds.length > 0) {
    const { data: profs } = await supabase
      .from("public_profiles").select("id, full_name").in("id", inspectorIds);
    for (const p of profs ?? []) inspectorNames.set(p.id as string, (p.full_name as string) ?? null);
  }
  const inspectors = (inspectorRows ?? []).map((r) => ({
    ...r,
    profile: { full_name: inspectorNames.get(r.id as string) ?? null },
  }));

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
      <div className="batta-frame-gold relative p-7">
        <div className="relative">
          <span className="batta-eyebrow">Pre-bid · inspection</span>
          <h1
            className={`mt-2 text-[24px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            <span className="gradient-gold-text">Request inspection</span>
          </h1>
          <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
            For{" "}
            <strong className="font-bold text-foreground">
              {property.title}
            </strong>{" "}
            · {property.governorate}
          </p>
          <div className="mt-6">
            <BookInspectionForm
              propertyId={property.id}
              inspectors={(inspectors ?? []).map((i) => ({
                id: i.id as string,
                speciality: i.speciality as string,
                rating_avg: Number(i.rating_avg ?? 0),
                full_name:
                  (i as unknown as { profile: { full_name: string | null } }).profile.full_name ??
                  "Inspector",
              }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
