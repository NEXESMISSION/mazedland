// Batta PWA service worker. Minimal hand-rolled (no Workbox) so we can
// reason about every line. Strategy:
//   - Navigations    : network-first, fall back to cached offline shell.
//   - Hashed assets  : cache-first (immutable, /_next/static/).
//   - Images         : cache-first into IMAGE_CACHE with an LRU cap. The
//                      seed catalogue + /_next/image variants stay hot
//                      across visits without growing unbounded.
//   - Other GETs     : stale-while-revalidate into RUNTIME_CACHE.
//   - Cross-origin & non-GET: passthrough, never cached.

const VERSION = "batta-v3";
const RUNTIME_CACHE = `${VERSION}-runtime`;
const ASSET_CACHE = `${VERSION}-assets`;
const IMAGE_CACHE = `${VERSION}-images`;

// Soft caps — we trim FIFO-style when we exceed these (oldest entries
// die first). The numbers are tuned for a Batta browse session: a user
// hitting the index pages might touch 60-100 thumbnails, and a typical
// supabase/_next/data response is ~10-50 KB, so 80 of each is generous.
const MAX_IMAGE_ENTRIES = 120;
const MAX_RUNTIME_ENTRIES = 80;

const PRECACHE = [
  "/icons/icon.svg",
  "/icons/icon-maskable.svg",
  "/icons/apple-touch-icon.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/**
 * Trim a cache down to `maxEntries` by deleting the oldest keys. Cache
 * Storage returns keys in insertion order, so this is effectively FIFO
 * which is a reasonable proxy for LRU on a browse-heavy workload.
 *
 * Called fire-and-forget after each cache.put so we never make the user
 * wait on housekeeping.
 */
async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    await cache.delete(keys[i]);
  }
}

/**
 * Heuristic for "this request fetches a bitmap that's worth caching".
 * Catches:
 *   - Direct hits on /public/properties/*.webp + the /icons/* set.
 *   - Next/Image-optimized URLs (`/_next/image?url=...`).
 *   - Anything served with an image/* MIME (covers Supabase storage
 *     proxy paths that don't end in a recognizable extension).
 */
function isImageRequest(request, url) {
  if (request.destination === "image") return true;
  if (url.pathname.startsWith("/_next/image")) return true;
  return /\.(?:avif|webp|jpe?g|png|gif|svg)$/i.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // HTML navigations — network-first with offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, fresh.clone());
          event.waitUntil(trim(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          // Last resort: any cached page so the shell still renders.
          const fallback = await caches.match("/");
          if (fallback) return fallback;
          return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        }
      })(),
    );
    return;
  }

  // Hashed Next.js build assets — cache-first (they never change).
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Images (real photos + next/image optimizer output + icons) —
  // cache-first into a dedicated IMAGE_CACHE so they survive the
  // RUNTIME_CACHE trim. Repeat views of the same listing are instant.
  if (isImageRequest(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const cached = await cache.match(request);
        if (cached) {
          // Refresh in the background so a re-encoded variant
          // eventually replaces the old one — but never make the user
          // wait for it.
          event.waitUntil(
            (async () => {
              try {
                const fresh = await fetch(request);
                if (fresh && fresh.ok && fresh.type === "basic") {
                  await cache.put(request, fresh.clone());
                  await trim(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
                }
              } catch { /* offline — keep what we had */ }
            })(),
          );
          return cached;
        }
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok && fresh.type === "basic") {
            await cache.put(request, fresh.clone());
            event.waitUntil(trim(IMAGE_CACHE, MAX_IMAGE_ENTRIES));
          }
          return fresh;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
    return;
  }

  // Everything else same-origin — stale-while-revalidate.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(request, response.clone());
            event.waitUntil(trim(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES));
          }
          return response;
        })
        .catch(() => undefined);
      return cached || (await networkPromise) || new Response("Offline", { status: 503 });
    }),
  );
});
