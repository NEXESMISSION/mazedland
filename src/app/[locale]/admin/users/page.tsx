import { getServerSupabase } from "@/lib/supabase/server";
import { ReviewKycButtons } from "@/components/admin/ReviewKycButtons";

export default async function AdminUsers() {
  const supabase = await getServerSupabase();
  const { data: subs } = await supabase
    .from("kyc_submissions")
    .select(`
      id, status, submitted_at, reviewer_notes,
      user:profiles!inner (id, full_name, phone, role, kyc_status)
    `)
    .order("submitted_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <span className="batta-eyebrow">Identity desk</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Users · KYC review
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Verify identity submissions before users can bid.
      </p>

      <div className="mt-5 space-y-2.5">
        {(subs ?? []).map((s) => {
          const u = (s as unknown as { user: { id: string; full_name: string | null; phone: string | null; role: string; kyc_status: string } }).user;
          return (
            <div
              key={s.id}
              className="rounded-xl bg-surface p-4 ring-1 ring-border transition-all hover:ring-gold-soft/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span className="batta-monogram size-10 shrink-0 not-italic text-[13px] font-extrabold">
                    {(u.full_name ?? "?")
                      .split(" ")
                      .map((p) => p[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold text-foreground">
                      {u.full_name ?? "(no name)"}
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                      {u.phone ?? "—"} · {u.role}
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      Submitted {new Date(s.submitted_at as string).toLocaleString()}
                    </div>
                  </div>
                </div>
                <span className="batta-tone-warn shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em]">
                  {s.status as string}
                </span>
              </div>
              <div aria-hidden className="batta-hairline mt-3" />
              <div className="mt-3">
                <ReviewKycButtons submissionId={s.id as string} userId={u.id} />
              </div>
            </div>
          );
        })}
        {(!subs || subs.length === 0) && (
          <div className="batta-frame-gold relative px-6 py-10 text-center text-[13px] text-muted">
            No KYC submissions waiting.
          </div>
        )}
      </div>
    </div>
  );
}
