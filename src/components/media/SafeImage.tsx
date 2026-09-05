"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

/**
 * next/image that recovers instead of leaving a hole in the page.
 *
 * THE FAILURE THIS EXISTS FOR. Most listing photos are still hosted on the
 * previous Supabase project, and the optimizer has to fetch each one from there
 * before it can transcode it. That origin answers a single request in 0.3–1.7s,
 * which is fine on its own and is not fine when a gallery or a page of cards
 * asks for twenty at once: some exceed the optimizer's upstream deadline and
 * come back
 *
 *     504 — "url" parameter is valid but upstream response timed out
 *
 * Measured: 4 of 32 concurrent cold transforms failed that way. An <img> whose
 * source 504s renders nothing at all, which is the "sometimes the images stick
 * and don't load" report — some photos in a gallery present, others simply
 * blank, differently on every reload.
 *
 * WHAT IT DOES. A failure is retried once through the optimizer — the timeout
 * is a queue, not a broken file, and the second attempt usually lands. If that
 * fails too it drops to `unoptimized`, which fetches the original straight from
 * storage and skips the optimizer entirely. Those originals are already webp
 * and 40–90KB, and they answer reliably: a photo a little heavier than it
 * needed to be is worth immeasurably more than an empty rectangle.
 *
 * Remounting via `key` is what makes the retry a real second request rather
 * than the browser handing back its cached failure.
 *
 * This is a patch over a hosting problem, not a fix for it. The fix is to move
 * those photos into the project the site actually runs on, so the optimizer
 * stops making a cross-project round trip per variant.
 */
export function SafeImage(props: ImageProps) {
  // 0 = optimized, 1 = optimized retry, 2 = straight from storage.
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
      unoptimized={unoptimized || attempt >= 2}
      onError={(e) => {
        setAttempt((a) => (a < 2 ? a + 1 : a));
        onError?.(e);
      }}
    />
  );
}
