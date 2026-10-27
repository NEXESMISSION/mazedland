"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

/**
 * next/image that recovers instead of leaving a hole in the page.
 *
 * Each size comes from the loader (src/lib/imageLoader.ts): Supabase's
 * resizer for stored photos, a file made in advance for the static ones. If
 * that size fails — the resizer is down, a static size was never made — the
 * picture drops to `unoptimized` at once: the original, straight from where it
 * is stored. A heavier photo is worth more than an empty rectangle.
 *
 * It used to retry once first, for the 504s of Vercel's optimizer. With that
 * optimizer out of quota (402, 2026-10-27) the retry only added a second
 * failed request before every picture, and the catalogue's first photo on a
 * phone waited 3 s for it.
 *
 * Remounting via `key` makes the fallback a real new request rather than the
 * browser handing back its cached failure.
 */
export function SafeImage(props: ImageProps) {
  // 0 = through the loader, 1 = the original, straight from storage.
  const [attempt, setAttempt] = useState(0);
  // `alt` is pulled out and passed by name rather than through the spread:
  // ImageProps already requires it, but jsx-a11y cannot see through `{...rest}`
  // and reports every use of this component as missing one.
  const { onError, unoptimized, alt, ...rest } = props;

  return (
    <Image
      {...rest}
      alt={alt}
      key={attempt}
      unoptimized={unoptimized || attempt >= 1}
      onError={(e) => {
        setAttempt(1);
        onError?.(e);
      }}
    />
  );
}
