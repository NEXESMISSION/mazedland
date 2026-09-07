import { Loader2, Check } from "lucide-react";

/**
 * One button vocabulary for the whole console — flat.
 *
 * The old set had seven filled variants (emerald, red, amber, navy…), so a
 * screen with four actions had four competing blocks of colour and no way to
 * tell which one you were meant to press. Now exactly **one** button on a
 * screen is filled — the primary action — and everything else is a hairline
 * outline or plain text. Colour returns only where it means danger.
 *
 * The legacy variant names still resolve, so the screens not yet rebuilt keep
 * compiling and quietly inherit the flat look:
 *   success → primary · dangerSoft → danger · warnSoft/ghost/neutral → default
 */
export type AdminButtonVariant =
  | "primary"
  | "default"
  | "danger"
  | "quiet"
  // Legacy aliases — kept so un-rebuilt screens keep working.
  | "success"
  | "dangerSoft"
  | "warnSoft"
  | "ghost"
  | "neutral";

export type AdminButtonSize = "sm" | "md";

const SIZES: Record<AdminButtonSize, string> = {
  sm: "h-7 gap-1.5 px-2.5 text-[12px]",
  md: "h-8 gap-1.5 px-3 text-[12.5px]",
};

const VARIANTS: Record<string, string> = {
  // The single filled element on any screen.
  primary:
    "bg-[var(--gold)] text-black hover:bg-[var(--gold-bright)] disabled:hover:bg-[var(--gold)]",
  // Hairline outline — the default for everything else.
  default:
    "border border-border text-foreground hover:border-[var(--gold-soft)] hover:text-[var(--gold)]",
  // Danger is text + border, never a fill: a red block reads as an error
  // message, not as a control you may press on purpose.
  danger:
    "border border-[var(--tone-bad-ring)] text-[var(--tone-bad)] hover:border-[var(--tone-bad)] hover:bg-[var(--tone-bad-bg)]",
  // No border at all — tertiary, inside a row or a toolbar.
  quiet: "text-muted hover:text-foreground",
};

const ALIAS: Record<string, keyof typeof VARIANTS> = {
  success: "primary",
  dangerSoft: "danger",
  warnSoft: "default",
  ghost: "default",
  neutral: "default",
};

function resolve(v: AdminButtonVariant): string {
  return VARIANTS[ALIAS[v] ?? v] ?? VARIANTS.default;
}

export function adminBtn(
  variant: AdminButtonVariant = "primary",
  size: AdminButtonSize = "sm",
): string {
  return `inline-flex items-center justify-center whitespace-nowrap rounded font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${SIZES[size]} ${resolve(variant)}`;
}

export function AdminButton({
  variant = "default",
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
    glyph = <Check className="size-3.5" strokeWidth={2.8} />;
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
      className={`${adminBtn(variant, size)} ${done ? "!border-transparent !bg-[var(--tone-ok)] !text-black" : ""} ${className}`}
    >
      {glyph}
      {label}
    </button>
  );
}
