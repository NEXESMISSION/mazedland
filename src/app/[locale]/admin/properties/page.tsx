import { getServerSupabase } from "@/lib/supabase/server";
import { ApprovePropertyButtons } from "@/components/admin/ApprovePropertyButtons";

export default async function AdminProperties() {
  const supabase = await getServerSupabase();
  const { data } = await supabase
    .from("properties")
    .select("id, title, governorate, type, status, owner_id, created_at, rejection_reason")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div>
      <span className="batta-eyebrow">Consignment queue</span>
      <h2 className="mt-1.5 text-[22px] font-extrabold leading-tight tracking-tight">
        Properties
      </h2>
      <p className="mt-1 text-[12px] text-muted">
        Approve listings → makes them visible on /properties.
      </p>

      <div className="mt-5 space-y-2.5">
        {(data ?? []).map((p) => (
          <div
            key={p.id}
            className="rounded-xl bg-surface p-4 ring-1 ring-border transition-all hover:ring-gold-soft/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-bold text-foreground">{p.title}</div>
                <div className="mt-1 truncate text-[10.5px] uppercase tracking-[0.14em] text-muted">
                  {p.governorate} · {p.type as string} ·{" "}
                  {new Date(p.created_at as string).toLocaleDateString()}
                </div>
                {p.rejection_reason ? (
                  <div className="batta-tone-bad mt-2 rounded-md px-2 py-1 text-[10.5px]">
                    {String(p.rejection_reason)}
                  </div>
                ) : null}
              </div>
              <StatusPill status={p.status as string} />
            </div>
            <div aria-hidden className="batta-hairline mt-3" />
            <div className="mt-3 flex justify-end">
              <ApprovePropertyButtons id={p.id as string} status={p.status as string} />
            </div>
          </div>
        ))}
        {(!data || data.length === 0) && (
          <div className="batta-frame-gold relative px-6 py-10 text-center text-[13px] text-muted">
            No properties submitted yet.
          </div>
        )}
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
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.14em] ${tone}`}>
      {status}
    </span>
  );
}
