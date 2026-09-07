import { statusLabel, statusTone, TONE_TEXT, type Tone } from "./tones";

/**
 * Status, as a dot and a word.
 *
 * It used to be a filled pill — a coloured rectangle with a border, repeated
 * on every row. Twenty-five of those down a list is twenty-five competing
 * blocks of colour, and the eye has nowhere to rest. A 5px dot carries the
 * same information at a fraction of the visual weight, which is what lets a
 * dense list stay readable.
 */

const DOT: Record<Tone, string> = {
  ok: "bg-[var(--tone-ok)]",
  warn: "bg-[var(--tone-warn)]",
  bad: "bg-[var(--tone-bad)]",
  info: "bg-[var(--gold)]",
  neutral: "bg-[var(--foreground-subtle)]",
};

export function StatusPill({
  status,
  tone,
  children,
  /** Dot only — for a dense row where the column header already says what it is. */
  dotOnly = false,
  className = "",
}: {
  status?: string | null;
  tone?: Tone;
  children?: React.ReactNode;
  dotOnly?: boolean;
  className?: string;
}) {
  const resolved: Tone = tone ?? statusTone(status);
  const label = children ?? statusLabel(status);

  if (dotOnly) {
    return (
      <span
        title={typeof label === "string" ? label : undefined}
        className={`inline-block size-[5px] shrink-0 rounded-full ${DOT[resolved]} ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 text-[11.5px] font-semibold ${TONE_TEXT[resolved]} ${className}`}
    >
      <span className={`size-[5px] shrink-0 rounded-full ${DOT[resolved]}`} />
      {label}
    </span>
  );
}
