/**
 * The band at the top of every console screen: eyebrow, title, one line of
 * description, and the screen's primary actions on the right.
 *
 * Extends the old `AdminPageHeader` with `actions` that survive a narrow
 * viewport (they used to sit in a `shrink-0` div next to a title that was
 * free to grow, so on a phone the button was pushed off-screen) and with
 * `stat`, for the one number a screen is really about — how many are waiting.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  stat,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  /** e.g. `{ value: 12, label: "à valider" }` — rendered beside the title. */
  stat?: { value: number | string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-border pb-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {eyebrow && (
            <span className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-muted">
              {eyebrow}
            </span>
          )}
          <div className="mt-1.5 flex items-baseline gap-3">
            <h1 className="text-[26px] font-extrabold leading-[1.1] tracking-tight text-foreground">
              {title}
            </h1>
            {stat && (
              <span className="batta-tabular text-[13px] font-bold text-muted">
                {stat.value}{" "}
                <span className="font-semibold text-subtle">{stat.label}</span>
              </span>
            )}
          </div>
          {description && (
            <p className="mt-2 max-w-2xl text-[12.5px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
