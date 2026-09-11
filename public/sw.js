// Mazed Immo PWA service worker. Hand-rolled (no Workbox) so every line can be
// reasoned about. What it handles, and deliberately NOTHING else:
//   - Navigations   : network-first, cached copy only when offline.
//   - Hashed assets : cache-first (/_next/static/ never changes under a URL).
//   - Images        : cache-first into IMAGE_CACHE with a FIFO cap.
//
// WHAT CHANGED (v5). There used to be a fourth branch: stale-while-revalidate
// for "everything else same-origin". On this app everything else is DATA —
// React Server Component payloads (`?_rsc=`), router prefetches, and every
// `/api/*` GET (notifications, favourites, health). Stale-while-revalidate
// answers from the cache FIRST, so a seller who had just published an annonce,
// or a user with a new notification, could be shown the previous state until
// they reloaded. And when the background fetch failed it invented a 503, which
// is what an anonymous visitor's console showed for every account-link
// prefetch. Dynamic data now always goes straight to the network.
//
// Bumping VERSION makes `activate` delete the v4 caches, including every RSC
// and API response the old branch had stored.

const VERSION = "mazed-v5";
const RUNTIME_CACHE = `${VERSION}-pages`;
const ASSET_CACHE = `${VERSION}-assets`;
const IMAGE_CACHE = `${VERSION}-images`;

// Soft caps, trimmed oldest-first. Each photo is fetched at several widths
// (responsive `sizes`), so the image cap has to cover a catalogue scroll.
const MAX_IMAGE_ENTRIES = 400;
const MAX_PAGE_ENTRIES = 40;

const PRECACHE = [
  // Only what the DOCUMENT asks for. The 512px PWA icons are fetched by the OS
  // at install time, not by the page.
  "/icons/icon-192.png",
  "/manifest.webmanifest",
];

// Pages that describe ONE signed-in person. They are never written to the
// cache: on a shared device, the offline copy of someone's account or payments
// page must not outlive their session.
const PRIVATE_PREFIX = /^\/[a-z]{2}\/(account|admin|payment|annonces\/nouvelle)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** Delete the oldest entries until the cache is within `maxEntries`. */
async function trim(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

function isImageRequest(request, url) {
  if (request.destination === "image") return true;
  if (url.pathname.startsWith("/_next/image")) return true;
  return /\.(?:avif|webp|jpe?g|png|gif|svg)$/i.test(url.pathname);
}

/** RSC payloads and router prefetches: data, not documents. Never touched. */
function isFlightRequest(request, url) {
  return (
    url.searchParams.has("_rsc") ||
    request.headers.get("RSC") === "1" ||
    request.headers.has("Next-Router-Prefetch") ||
    request.headers.has("Next-Router-State-Tree")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isFlightRequest(request, url)) return;
  if (url.pathname.startsWith("/api/")) return;

  // HTML navigations — network-first; the cache is only an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok && fresh.type === "basic" && !fresh.redirected && !PRIVATE_PREFIX.test(url.pathname)) {
            const cache = await caches.open(RUNTIME_CACHE);
            await cache.put(request, fresh.clone());
            event.waitUntil(trim(RUNTIME_CACHE, MAX_PAGE_ENTRIES));
          }
          return fresh;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = (await caches.match("/fr")) || (await caches.match("/"));
          if (shell) return shell;
          return new Response("Hors ligne", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
      })(),
    );
    return;
  }

  // Hashed build assets — cache-first; a URL's content never changes.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Images — cache-first, refreshed in the background.
  if (isImageRequest(request, url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const cached = await cache.match(request);
        const refresh = fetch(request).then(async (fresh) => {
          if (fresh && fresh.ok && fresh.type === "basic") {
            await cache.put(request, fresh.clone());
            await trim(IMAGE_CACHE, MAX_IMAGE_ENTRIES);
          }
          return fresh;
        });
        if (cached) {
          event.waitUntil(refresh.catch(() => {}));
          return cached;
        }
        try {
          return await refresh;
        } catch {
          return new Response("", { status: 504 });
        }
      })(),
    );
  }

  // Anything else (manifest, fonts, robots…) is left to the browser.
});
