import { getServerSupabase } from "@/lib/supabase/server";
import { Link } from "@/i18n/navigation";
import { Flame } from "lucide-react";
import { LiveCountdown } from "./LiveCountdown";
import { EndingSoonSlider } from "./EndingSoonSlider";
import type { EndingSoonItem } from "./EndingSoonSlider";

/**
 * Highest-urgency surface on the landing: the auctions closest to
 * closing in the next hour. Renders inline (above the trending rail)
 * so the urgency sits in the user's main eye-line.
 *
 * One match → a single static banner (no rotation needed).
 * Two or more → a slider that auto-advances every 1.5 s so each lot
 * gets a turn in the same prime slot, instead of burying the rest
 * deeper in the page. Returns null when there's nothing about to
 * close so the banner only appears when it has real signal.
 */
export async function EndingSoonBanner() {
  let items: EndingSoonItem[] = [];
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
      .limit(8);
    items = (data ?? []).map((row) => {
      const p = (row as unknown as { property: { title: string; governorate: string } }).property;
      return {
        id: row.id as string,
        title: p.title,
        governorate: p.governorate,
        endsAt: row.ends_at as string,
      } satisfies EndingSoonItem;
    });
  } catch {
    // env missing — render nothing.
  }

  if (items.length === 0) return null;

  // Single item → keep the original static banner. Avoids spinning up
  // a client component (state + interval) for a rail that never moves.
  if (items.length === 1) {
    const next = items[0];
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

  return (
    <section className="px-4">
      <EndingSoonSlider items={items} />
    </section>
  );
}
