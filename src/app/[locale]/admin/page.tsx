import { getServerSupabase } from "@/lib/supabase/server";

export default async function AdminOverview() {
  const supabase = await getServerSupabase();

  const [propsCount, pendingProps, kycCount, inspectorsCount, waitlistCount, liveAuctions, pendingPayouts] = await Promise.all([
    supabase.from("properties").select("*", { count: "exact", head: true }),
    supabase.from("properties").select("*", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase.from("kyc_submissions").select("*", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("inspectors").select("*", { count: "exact", head: true }).eq("approved", false),
    supabase.from("waitlist").select("*", { count: "exact", head: true }),
    supabase.from("auctions").select("*", { count: "exact", head: true }).in("status", ["live", "extending"]),
    supabase.from("seller_payouts").select("*", { count: "exact", head: true }).in("status", ["requested", "processing"]),
  ]);

  const cards = [
    { label: "Properties total", value: propsCount.count ?? 0 },
    { label: "Pending review", value: pendingProps.count ?? 0, highlight: true },
    { label: "KYC submissions", value: kycCount.count ?? 0, highlight: true },
    { label: "Pending payouts", value: pendingPayouts.count ?? 0, highlight: (pendingPayouts.count ?? 0) > 0 },
    { label: "Inspector apps", value: inspectorsCount.count ?? 0 },
    { label: "Waitlist signups", value: waitlistCount.count ?? 0 },
    { label: "Live auctions", value: liveAuctions.count ?? 0 },
  ];

  return (
    <div>
      <span className="batta-eyebrow">The console</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Overview
      </h2>
      <p className="mt-1 text-[12px] text-muted">شفافية. سرعة. ثقة.</p>

      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className={`rounded-xl p-4 ring-1 ${
              c.highlight
                ? "bg-gold-faint ring-gold/30"
                : "bg-surface ring-border"
            }`}
          >
            <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted">
              {c.label}
            </div>
            <div
              className={`batta-tabular mt-1.5 text-[28px] font-extrabold leading-none ${
                c.highlight ? "gradient-gold-text" : "text-foreground"
              }`}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
