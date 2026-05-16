import { getServerSupabase } from "@/lib/supabase/server";
import { ApproveInspectorButton } from "@/components/admin/ApproveInspectorButton";

export default async function AdminInspectors() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("inspectors")
    .select(`
      id, speciality, governorates, approved, created_at,
      profile:profiles!inner (full_name, phone)
    `)
    .order("created_at", { ascending: false });

  return (
    <div>
      <span className="batta-eyebrow">Accreditation</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Inspectors
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Approve applicants → unlocks them on /inspectors and the booking flow.
      </p>

      <div className="mt-5 space-y-2.5">
        {(data ?? []).map((i) => {
          const p = (i as unknown as { profile: { full_name: string | null; phone: string | null } }).profile;
          return (
            <div
              key={i.id}
              className="rounded-xl bg-surface p-4 ring-1 ring-border transition-all hover:ring-gold-soft/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-2.5">
                  <span className="batta-monogram size-10 shrink-0 not-italic text-[13px] font-extrabold">
                    {(p.full_name ?? "?")
                      .split(" ")
                      .map((part) => part[0])
                      .filter(Boolean)
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold text-foreground">
                      {p.full_name ?? "(no name)"}
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                      {(i.speciality as string).replace(/_/g, " ")} · {p.phone ?? "—"}
                    </div>
                    <div className="mt-1 text-[10px] text-muted">
                      {((i.governorates as string[]) ?? []).join(", ") || "—"}
                    </div>
                  </div>
                </div>
                {i.approved ? (
                  <span className="batta-tone-ok shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em]">
                    approved
                  </span>
                ) : (
                  <span className="batta-tone-warn shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em]">
                    pending
                  </span>
                )}
              </div>
              {!i.approved && (
                <>
                  <div aria-hidden className="batta-hairline mt-3" />
                  <div className="mt-3 flex justify-end">
                    <ApproveInspectorButton id={i.id as string} />
                  </div>
                </>
              )}
            </div>
          );
        })}
        {(!data || data.length === 0) && (
          <div className="batta-frame-gold relative px-6 py-10 text-center text-[13px] text-muted">
            No applications yet.
          </div>
        )}
      </div>
    </div>
  );
}
