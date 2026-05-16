import { getServerSupabase } from "@/lib/supabase/server";

export default async function AdminWaitlist() {
  const supabase = await getServerSupabase();
  const { data, count } = await supabase
    .from("waitlist")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(500);

  return (
    <div>
      <span className="batta-eyebrow">Pre-launch</span>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold leading-tight tracking-tight">
          Waitlist
        </h2>
        <span className="batta-pill-gold">{count ?? 0} signups</span>
      </div>

      <div className="mt-5 overflow-hidden rounded-xl bg-surface ring-1 ring-border">
        <ul className="divide-y divide-border">
          {(data ?? []).map((w) => (
            <li key={w.id as string} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] text-foreground">
                  {w.email as string}
                </div>
                <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.14em] text-muted">
                  {(w.phone as string | null) ?? "—"} · {w.locale as string} ·{" "}
                  {(w.source as string | null) ?? "—"}
                </div>
              </div>
              <div className="batta-tabular shrink-0 text-[10px] text-muted">
                {new Date(w.created_at as string).toLocaleDateString()}
              </div>
            </li>
          ))}
          {(!data || data.length === 0) && (
            <li className="p-8 text-center text-[13px] text-muted">No signups yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
