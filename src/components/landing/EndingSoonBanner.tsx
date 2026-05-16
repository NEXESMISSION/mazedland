import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { Flame } from "lucide-react";
import { LiveCountdown } from "./LiveCountdown";

/**
 * Highest-urgency surface on the landing: the single auction closest
 * to closing in the next hour. Renders inline (above the trending rail)
 * so the urgency sits in the user's main eye-line. The countdown
 * itself is a per-second ticker.
 *
 * Returns null when there's nothing about to close so the banner only
 * appears when it has real signal — avoids "ending soon!" noise on a
 * page where nothing actually is.
 */
export async function EndingSoonBanner() {
  let next: { id: string; title: string; governorate: string; endsAt: string } | null = null;
  try {
    const supabase = await getServerSupabase();
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("auctions")
      .select(`
        id, ends_at, status,
        property:properties!inner (title, governorate, status)
      `)
      .in("status", ["live", "extending"])
      .eq("property.status", "ready")
      .gt("ends_at", new Date().toISOString())
      .lt("ends_at", inOneHour)
      .order("ends_at", { ascending: true })
      .limit(1);
    const row = data?.[0];
    if (row) {
      const p = (row as unknown as { property: { title: string; governorate: string } }).property;
      next = {
        id: row.id as string,
        title: p.title,
        governorate: p.governorate,
        endsAt: row.ends_at as string,
      };
    }
  } catch {
    // env missing — render nothing.
  }

  if (!next) return null;

  return (
    <section className="px-4">
      <Link
        href={`/auctions/${next.id}` as `/auctions/${string}`}
        className="batta-fade-up flex items-center gap-3 rounded-2xl bg-gradient-to-r from-red-600 to-red-500 p-3 text-white shadow-lg shadow-red-500/25 active:scale-[0.99] transition"
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <Flame className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-white/80">
            Ending soon
          </div>
          <div className="truncate text-sm font-bold">
            {next.title} · {next.governorate}
          </div>
        </div>
        <div className="shrink-0">
          <LiveCountdown endsAt={next.endsAt} />
        </div>
      </Link>
    </section>
  );
}
