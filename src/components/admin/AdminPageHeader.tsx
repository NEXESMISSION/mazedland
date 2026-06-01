/**
 * Shared admin page header. Every queue used to hand-roll the same
 * eyebrow + h2 + muted-paragraph stack at slightly different sizes; this
 * unifies them into one airy, hairline-separated band (no box) with a
 * larger title — the spine of the minimal console look. `actions` renders
 * on the right of the title row (filters, primary buttons, etc.).
 */
export function AdminPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-b border-border pb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <span className="batta-eyebrow">{eyebrow}</span>}
          <h1 className="mt-2 text-[28px] font-extrabold leading-[1.1] tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
