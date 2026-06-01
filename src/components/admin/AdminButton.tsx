import { Loader2, Check } from "lucide-react";

/**
 * One button vocabulary for the whole admin console. Before this, every
 * queue hand-rolled its own emerald/red/amber Tailwind classes — colors
 * that clashed with the navy brand and drifted page to page. Everything
 * routes through these tokens now (--gold = navy primary, --success,
 * --danger/--accent, --warning) so the console reads as one product.
 *
 * Use `adminBtn(variant, size)` for the className when you need a <Link>
 * or <a>; use the <AdminButton> component for real buttons (it wires the
 * pending spinner + disabled state for you).
 */
export type AdminButtonVariant =
  | "primary" // navy fill — main affirmative action
  | "success" // green fill — approve / verify
  | "danger" // red fill — destructive submit
  | "dangerSoft" // tinted red — reject link, lower weight
  | "warnSoft" // tinted amber — restore / caution
  | "ghost" // bordered, neutral — secondary
  | "neutral"; // soft gray — tertiary

export type AdminButtonSize = "sm" | "md";

const SIZES: Record<AdminButtonSize, string> = {
  sm: "h-8 gap-1 px-3 text-xs",
  md: "h-9 gap-1.5 px-4 text-[13px]",
};

const VARIANTS: Record<AdminButtonVariant, string> = {
  primary:
    "bg-[var(--gold)] text-white shadow-sm hover:bg-[var(--gold-bright)]",
  success:
    "bg-[var(--success)] text-white shadow-sm hover:brightness-95",
  danger:
    "bg-[var(--danger)] text-white shadow-sm hover:bg-[var(--accent-bright)]",
  dangerSoft:
    "bg-[var(--accent-faint)] text-[var(--accent-deep)] ring-1 ring-[var(--accent-soft)] hover:bg-[var(--accent)]/10",
  warnSoft:
    "bg-[rgba(245,158,11,0.12)] text-[#92400e] ring-1 ring-[rgba(245,158,11,0.35)] hover:bg-[rgba(245,158,11,0.2)]",
  ghost:
    "border border-border bg-surface text-foreground hover:border-[var(--gold-soft)] hover:text-[var(--gold)]",
  neutral:
    "bg-surface-2 text-foreground ring-1 ring-border hover:bg-surface-3",
};

export function adminBtn(
  variant: AdminButtonVariant = "primary",
  size: AdminButtonSize = "sm",
): string {
  return `inline-flex items-center justify-center whitespace-nowrap rounded-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]}`;
}

export function AdminButton({
  variant = "primary",
  size = "sm",
  pending = false,
  pendingLabel,
  done = false,
  doneLabel,
  icon,
  disabledReason,
  children,
  className = "",
  ...rest
}: {
  variant?: AdminButtonVariant;
  size?: AdminButtonSize;
  /** Shows a spinner and disables the button. */
  pending?: boolean;
  /** Label shown while `pending` (defaults to `children`). */
  pendingLabel?: React.ReactNode;
  /** Transient success — shows a check + swaps to `doneLabel` for ~1.5s. */
  done?: boolean;
  doneLabel?: React.ReactNode;
  /** Leading icon (hidden while pending/done — the spinner/check take its place). */
  icon?: React.ReactNode;
  /** Why the button is disabled — surfaced as a tooltip + aria-label. */
  disabledReason?: string;
  children?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const isDisabled = pending || rest.disabled;
  let glyph: React.ReactNode = icon;
  let label: React.ReactNode = children;
  if (done) {
    glyph = <Check className="size-3.5" strokeWidth={2.6} />;
    label = doneLabel ?? children;
  } else if (pending) {
    glyph = <Loader2 className="size-3.5 animate-spin" />;
    label = pendingLabel ?? children;
  }
  return (
    <button
      {...rest}
      disabled={isDisabled}
      title={isDisabled && !pending ? disabledReason : undefined}
      aria-label={isDisabled && !pending && disabledReason ? disabledReason : undefined}
      className={`${adminBtn(variant, size)} ${done ? "!bg-[var(--success)] !text-white" : ""} ${className}`}
    >
      {glyph}
      {label}
    </button>
  );
}
