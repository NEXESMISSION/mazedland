import { Link } from "@/i18n/navigation";
import { getServerSupabase } from "@/lib/supabase/server";

const ALL_GOVERNORATES = [
  "Tunis", "Ariana", "Ben Arous", "Manouba",
  "Sousse", "Monastir", "Mahdia", "Nabeul",
  "Sfax", "Bizerte", "Gabès", "Médenine",
  "Kairouan", "Béja", "Jendouba", "Kef",
  "Kasserine", "Sidi Bouzid", "Gafsa", "Tozeur",
  "Kebili", "Tataouine", "Siliana", "Zaghouan",
];

/**
 * Compact Tunisia coverage strip. Renders ONLY wilayas with at least
 * one live auction — pulsing gold dot + count, sorted by count desc.
 * A trailing "+N wilayas" pill jumps to /properties with no filter for
 * the cold ones. The old "render every pill" layout was a wall of
 * dead chips that buried the actual signal.
 *
 * Falls back to a small curated set of major wilayas when env is
 * missing or there are no live auctions, so the marketing footprint
 * stays visible even on a fresh dev clone.
 */
// Always-on tier — major wilayas that should appear even when nothing
// is live, so the strip never collapses to a handful of lonely pills.
// Cold pills render in a faded state; lit pills overwrite the cold
// version when they have auctions.
const MAJORS = [
  "Tunis", "Ariana", "Ben Arous", "Sousse",
  "Sfax", "Nabeul", "Bizerte", "Monastir",
];

export async function CoverageStrip() {
  const counts = await loadCounts();
  const hot = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Build the display list: lit wilayas first (sorted by count), then
  // major-tier cold wilayas filling to a minimum of 10 pills so the
  // strip looks substantial even on a fresh DB.
  const seen = new Set<string>();
  const display: { g: string; n: number; fallback: boolean }[] = [];
  for (const [g, n] of hot) {
    display.push({ g, n, fallback: false });
    seen.add(g);
    if (display.length >= 10) break;
  }
  for (const g of MAJORS) {
    if (display.length >= 10) break;
    if (seen.has(g)) continue;
    display.push({ g, n: 0, fallback: true });
    seen.add(g);
  }
  const remaining = ALL_GOVERNORATES.length - display.length;

  return (
    <section className="px-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-bold leading-tight text-foreground">
          Partout en Tunisie
        </h2>
        <span className="text-[11px] text-muted">{ALL_GOVERNORATES.length} gouvernorats</span>
      </header>

      <ul className="flex flex-wrap gap-1.5">
        {display.map(({ g, n, fallback }) => (
          <li key={g}>
            <Link
              href={`/properties?gov=${encodeURIComponent(g)}` as `/properties`}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition active:scale-[0.97] ${
                fallback
                  ? "bg-batta-surface/40 text-batta-muted"
                  : "bg-batta-surface text-batta-cream"
              }`}
            >
              {!fallback && (
                <span
                  className="batta-pulse-dot inline-flex size-1.5 rounded-full bg-batta-gold text-batta-gold/50"
                  aria-hidden
                />
              )}
              {g}
              {n > 0 && (
                <span className="batta-gold-fill ms-0.5 rounded-full px-1.5 text-[10px] font-bold">
                  {n}
                </span>
              )}
            </Link>
          </li>
        ))}
        {remaining > 0 && (
          <li>
            <Link
              href="/properties"
              className="inline-flex items-center gap-1 rounded-full border border-batta-gold/15 bg-batta-surface/40 px-2.5 py-1 text-[11px] font-semibold text-batta-muted"
            >
              +{remaining} autres
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

async function loadCounts(): Promise<Map<string, number>> {
  try {
    const supabase = await getServerSupabase();
    const { data } = await supabase
      .from("auctions")
      .select(`status, property:properties!inner (governorate, status)`)
      .in("status", ["live", "extending"])
      .eq("property.status", "ready")
      .limit(500);
    const map = new Map<string, number>();
    for (const row of (data ?? []) as unknown as Array<{
      property: { governorate: string };
    }>) {
      const g = row.property.governorate;
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return map;
  } catch {
    return new Map();
  }
}
