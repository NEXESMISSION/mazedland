import { redirect } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { getLocale } from "next-intl/server";
import { Plus, Briefcase } from "lucide-react";

// Per-user, auth-gated — never static (env-less prerender would throw + fail the build).
export const dynamic = "force-dynamic";

/**
 * Partner dashboard — bank, agency, bailiff portfolio view. Identity
 * card on top with role + counts, then a properties list. Visual
 * language matches the redesigned account hub.
 */
export default async function PartnerDashboard({
  params,
}: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const currentLocale = await getLocale();
  const isRTL = currentLocale === "ar";
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect({ href: "/login", locale: locale as "ar" | "fr" | "en" });

  const { data: profile } = await supabase
    .from("profiles").select("role, full_name").eq("id", user!.id).single();

  if (!profile || (profile.role !== "bank" && profile.role !== "agency" && profile.role !== "bailiff")) {
    return (
      <div className="mx-auto max-w-[var(--max-w)] px-4 py-10 text-center lg:max-w-[var(--max-w-content)]">
        <div className="batta-frame-gold relative p-7">
          <div className="relative">
            <span className="batta-monogram mx-auto inline-flex size-12 items-center justify-center text-[20px]">
              <Briefcase className="size-5" strokeWidth={2.2} />
            </span>
            <p className="mt-4 text-[14px] text-muted">
              Cet espace est réservé aux comptes partenaires.
            </p>
            <Link
              href="/partners"
              className="batta-btn-luxe tap-target mt-5 inline-flex w-full px-5 py-3 text-[13.5px]"
            >
              Voir les offres partenaires
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Aggregate over the partner's listings.
  const [listings, liveAuctions, sold] = await Promise.all([
    supabase
      .from("properties")
      .select("id, title, status, governorate, type, created_at")
      .eq("owner_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("auctions")
      .select("id, status, current_price, ends_at, property:properties!inner(owner_id, title)")
      .eq("property.owner_id", user!.id)
      .in("status", ["live", "extending"]),
    supabase
      .from("auctions")
      .select("id, winner_amount, hammer_at, property:properties!inner(owner_id, title)")
      .eq("property.owner_id", user!.id)
      .in("status", ["ended_sold", "awarded"])
      .order("hammer_at", { ascending: false })
      .limit(20),
  ]);

  const gmv = (sold.data ?? []).reduce(
    (sum, a) => sum + Number(a.winner_amount ?? 0), 0,
  );

  return (
    <div className="mx-auto max-w-[var(--max-w)] px-4 py-6 lg:max-w-[var(--max-w-content)]">
      {/* Header — name, role pill, "+ New" CTA. */}
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="batta-eyebrow">Partner portfolio</span>
          <h1
            className={`mt-1.5 text-[24px] font-extrabold leading-tight tracking-tight ${
              isRTL ? "font-arabic" : ""
            }`}
          >
            Partner dashboard
          </h1>
          <p className="mt-1 truncate text-[12px] text-muted">
            {profile.full_name}
            <span className="batta-pill-gold ms-2">{profile.role}</span>
          </p>
        </div>
        <Link
          href="/sell?new=1"
          className="batta-btn-luxe tap-target shrink-0 px-4 py-2.5 text-[12px]"
        >
          <Plus className="size-3.5" strokeWidth={2.5} />
          New
        </Link>
      </div>

      {/* Stats trio */}
      <div className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="Listings" value={(listings.data ?? []).length.toString()} />
        <Stat label="Live" value={(liveAuctions.data ?? []).length.toString()} />
        <Stat label="GMV TND" value={Math.round(gmv).toLocaleString("fr-TN")} />
      </div>

      {/* Properties */}
      <h2 className="mt-7 text-[15px] font-bold text-foreground">Your properties</h2>
      <ul className="mt-3 space-y-2 pb-6">
        {(listings.data ?? []).map((p) => (
          <li
            key={p.id as string}
            className="flex items-start justify-between gap-3 rounded-xl bg-surface p-3.5 ring-1 ring-border transition-all hover:ring-gold-soft/40"
          >
            <div className="min-w-0 flex-1">
              <div className={`truncate text-[14px] font-bold leading-tight text-foreground ${isRTL ? "font-arabic" : ""}`}>
                {p.title}
              </div>
              <div className="mt-1 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                {p.governorate} · {p.type}
              </div>
            </div>
            <StatusPill status={p.status as string} />
          </li>
        ))}
        {(listings.data ?? []).length === 0 && (
          <li className="batta-frame-gold relative px-6 py-10 text-center">
            <p className="text-[13px] text-muted">No listings yet.</p>
            <Link
              href="/sell?new=1"
              className="batta-btn-luxe tap-target mt-5 inline-flex px-5 py-2.5 text-[12.5px]"
            >
              <Plus className="size-3.5" strokeWidth={2.5} />
              Add your first listing
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface p-3 text-center ring-1 ring-border">
      <div className="batta-tabular gradient-gold-text text-[18px] font-extrabold leading-none">
        {value}
      </div>
      <div className="mt-1.5 text-[9.5px] font-extrabold uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "ready" ? "batta-tone-ok"
    : status === "pending_review" ? "batta-tone-warn"
    : status === "rejected" ? "batta-tone-bad"
    : "bg-surface-2 text-muted ring-1 ring-border";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
