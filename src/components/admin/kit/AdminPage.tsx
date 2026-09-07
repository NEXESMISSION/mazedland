/**
 * Screen wrappers.
 *
 * `AdminPage` is for a document-shaped screen — read top to bottom, one
 * column, a comfortable measure. It only sets the width; the shell's scroll
 * region already supplies the padding.
 *
 * `FullBleed` is the opposite: a screen that *is* the window. It cancels the
 * shell's padding and pins itself to the viewport so its own panes can scroll
 * independently — a list that holds its position while the detail beside it
 * changes. The header heights subtracted here are the shell's: nothing on
 * desktop, the 48 px mobile bar below `lg`.
 */

export function AdminPage({
  wide = false,
  children,
}: {
  /** Drop the measure for a genuinely tabular screen. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return <div className={wide ? "" : "mx-auto max-w-[1180px]"}>{children}</div>;
}

export function FullBleed({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-5 -my-6 flex h-[calc(100dvh-48px)] flex-col overflow-hidden lg:-mx-8 lg:-my-7 lg:h-dvh">
      {children}
    </div>
  );
}
