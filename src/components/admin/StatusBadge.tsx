/**
 * One status-pill vocabulary for the admin console. Replaces the
 * copy-pasted `inline-flex … rounded-full px-2.5 py-1 text-[9.5px]…`
 * blocks and the ad-hoc `batta-tone-*` lookups scattered across queues.
 * Tones map to the semantic tokens so a "Payé" pill looks identical
 * whether it's on the payouts list or the deposits ledger.
 */
export type BadgeTone = "ok" | "warn" | "bad" | "info" | "neutral";

const TONES: Record<BadgeTone, string> = {
  ok: "batta-tone-ok",
  warn: "batta-tone-warn",
  bad: "batta-tone-bad",
  info: "bg-[var(--gold-faint)] text-[var(--gold)] ring-1 ring-[var(--gold)]/25",
  neutral: "bg-surface-2 text-muted ring-1 ring-border",
};

export function StatusBadge({
  tone,
  icon,
  children,
  className = "",
}: {
  tone: BadgeTone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[9.5px] font-extrabold uppercase tracking-[0.12em] ${TONES[tone]} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
