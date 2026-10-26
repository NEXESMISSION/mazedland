/**
 * Keeps a left-to-right run — a phone number, a price with its currency, a
 * reference like MZ-00042, an IBAN — intact inside right-to-left text.
 *
 * Without it the bidi algorithm reorders the pieces around the Arabic: "+216
 * 98 124 111" can read "111 124 98 216+", and "MZ-00042" can split at the dash.
 * <bdi> isolates the run from its surroundings; dir="ltr" lays it out inside.
 * Harmless on French pages.
 */
export function Ltr({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}
