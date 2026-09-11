import type { ReactNode } from "react";

/**
 * The one breakpoint the split layouts use. Tailwind's `lg` is
 * `min-width: 64rem` (1024px): `lg:hidden` hides a tree at and above it,
 * `hidden lg:block` hides one below it.
 */
export const LG_UP = "(min-width: 1024px)";
export const BELOW_LG = "(max-width: 1023.98px)";

/** A 1×1 transparent GIF — what a matching <source> hands the <img> instead. */
export const EMPTY_GIF =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Stops an eagerly loaded image from downloading at the breakpoint where its
 * tree is hidden.
 *
 * Home and the auth pages render a mobile tree and a desktop tree and let CSS
 * pick one. `display: none` does not stop an eager <img> from being fetched —
 * only `loading="lazy"` does — so every phone also downloaded the desktop hero
 * photo, at high priority, competing with the photo it actually shows. A
 * <picture> takes the first <source> whose media query matches ahead of the
 * <img>'s own srcset, so a source pointing at an inline GIF makes the hidden
 * copy free while the visible one keeps eager loading and its fetch priority.
 *
 * Do not combine it with next/image's `preload` (`priority` before Next 16):
 * that emits a <link rel="preload"> with no media attribute, which downloads
 * regardless.
 *
 * `className` is for `fill` images. next/image expects the element directly
 * around a filled <img> to be positioned, so pass `absolute inset-0` there.
 */
export function HiddenAt({
  media,
  className,
  children,
}: {
  media: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <picture className={className}>
      <source media={media} srcSet={EMPTY_GIF} />
      {children}
    </picture>
  );
}
