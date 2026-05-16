import {
  Landmark,
  Building2,
  Scale,
  Gavel,
  ShieldCheck,
  Briefcase,
  University,
  HandCoins,
} from "lucide-react";

/**
 * Two-row "Built for" marquee, rows scrolling in opposite directions.
 *
 * Each row holds half the segments to keep the line lengths reasonable;
 * the visual effect is denser than a single rail without making the
 * page feel busy. The per-item `margin-inline-end` (instead of flex
 * `gap`) makes the half-translate seamless — `gap` would add an extra
 * space at the duplication seam and cause a visible jump every cycle.
 */
export function PartnersMarquee() {
  const top = SEGMENTS.slice(0, 4);
  const bottom = SEGMENTS.slice(4);
  return (
    <section>
      <div className="relative overflow-hidden py-2">
        {/* Edge fades shared across both rows. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-batta-paper to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-batta-paper to-transparent" />

        <ul className="batta-marquee">
          {top.map((s, i) => (
            <SegmentChip key={`top-a-${i}`} {...s} />
          ))}
          {top.map((s, i) => (
            <SegmentChip key={`top-b-${i}`} {...s} ariaHidden />
          ))}
        </ul>

        <ul className="batta-marquee-reverse mt-1.5">
          {bottom.map((s, i) => (
            <SegmentChip key={`btm-a-${i}`} {...s} />
          ))}
          {bottom.map((s, i) => (
            <SegmentChip key={`btm-b-${i}`} {...s} ariaHidden />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SegmentChip({
  Icon,
  label,
  ariaHidden,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  ariaHidden?: boolean;
}) {
  return (
    <li
      className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-2xl border border-batta-gold/20 bg-batta-surface px-3 py-2 ltr:me-2.5 rtl:ms-2.5"
      aria-hidden={ariaHidden}
    >
      <span className="inline-flex size-7 items-center justify-center rounded-lg border border-batta-gold/30 bg-batta-surface-2 text-batta-gold">
        <Icon className="size-3.5" />
      </span>
      <span className="text-xs font-semibold text-batta-cream">{label}</span>
    </li>
  );
}

const SEGMENTS: { Icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { Icon: Landmark,    label: "Banks" },
  { Icon: Building2,   label: "Real-estate agencies" },
  { Icon: Scale,       label: "Court bailiffs" },
  { Icon: Gavel,       label: "Notaries" },
  { Icon: ShieldCheck, label: "Accredited inspectors" },
  { Icon: Briefcase,   label: "Property lawyers" },
  { Icon: University,  label: "Public institutions" },
  { Icon: HandCoins,   label: "Diaspora investors" },
];
