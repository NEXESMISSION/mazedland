// Batta PWA service worker. Minimal hand-rolled (no Workbox) so we can
// reason about every line. Strategy:
//   - Navigations  : network-first, fall back to cached offline shell.
//   - Static assets: stale-while-revalidate so the UI loads instantly
//     and refreshes in the background.
//   - Same-origin API/_next/data: network-first with cache fallback.
//   - Cross-origin & POSTs: passthrough, never cached.

const VERSION = "batta-v1";
const RUNTIME_CACHE = `${VERSION}-runtime`;
const ASSET_CACHE = `${VERSION}-assets`;

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

  // Everything else same-origin — stale-while-revalidate.
  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);
      return cached || (await networkPromise) || new Response("Offline", { status: 503 });
    }),
  );
});
