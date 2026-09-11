import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Pin Turbopack to this app dir so it doesn't pick up a stray lockfile
  // higher in the tree. `import.meta.dirname` is Node 20+ and survives
  // Next's CJS-output transform of the config file.
  turbopack: {
    root: import.meta.dirname,
  },
  // lucide-react is named-imported across ~125 files. This rewrites those
  // named imports to per-icon deep imports at build time, guaranteeing only
  // the icons actually used are bundled (insurance against the barrel
  // re-export accidentally pulling the whole icon set) and speeding dev
  // compile. Safe, zero-behaviour-change.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  images: {
    // AVIF first, then WebP. AVIF is ~25–30 % smaller than WebP at the
    // same perceptual quality; next/image negotiates per request based
    // on the browser's Accept header so older browsers transparently
    // fall back to WebP. Our seed sources are WebP — the optimizer
    // decodes and re-encodes to AVIF on demand, caching the result.
    formats: ["image/avif", "image/webp"],
    // Next 16 rejects any next/image `quality` not in this allowlist with a
    // 400 (default permits only 75). The codebase thinks in q≈72 (see the
    // upload presets + the seed-optimization script), so whitelist the values
    // we actually use — otherwise a future `<Image quality={72}>` silently
    // 400s and renders a broken image. 75 stays the default for bare <Image>.
    qualities: [50, 60, 72, 75, 80, 86, 100],
    // Long-cache optimized variants on the CDN. They're keyed by
    // (source URL + width + quality + format) so this is safe.
    minimumCacheTTL: 60 * 60 * 24 * 30,
    // Property cards render small (≤ ~300px wide); cap the generated variants
    // so the optimizer stops emitting oversized 2048/3840 images for thumbnails
    // (fewer + smaller transforms = faster loads, lower bandwidth).
    deviceSizes: [360, 640, 828, 1080, 1280, 1920],
    imageSizes: [120, 200, 280, 384],
    // Scope to the Supabase Storage public path so the optimizer can only
    // transcode our OWN stored images, not arbitrary URLs on the project host.
    // Dropped the unsplash/picsum hosts (test-only, never rendered): allowing
    // huge public image hosts made /_next/image an anonymous denial-of-wallet —
    // an attacker varies url+width for unlimited cache-miss transcodes billed
    // to us. (Realtime/edge rate-limiting of /_next/image is a separate WAF
    // task; this removes the unbounded-distinct-source amplifier.)
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
    ],
  },
  /**
   * Admin routes retired by the pivot.
   *
   * Mazed Immo is a classifieds platform now, and the console lists six
   * destinations. The auction screens are unlinked from the rail, but an
   * unlinked page is still a page: bookmarks, browser history and the "why is
   * this 404" support ticket all outlive the menu. These send them somewhere
   * useful instead.
   *
   * An earlier pass kept /admin/deposits, /admin/auctions/[id] and
   * /admin/characteristics alive, on the grounds that cautions were still
   * holding bidder money and the auction sell form still read
   * `property_attribute_kinds`. Measuring the database settled it: there has
   * never been a single bid, and the only three "bidders" were the operator's
   * own accounts. There is no money to settle and no seller to strand, so all
   * three are gone with the rest.
   *
   * `renamed` is permanent (301) because those screens moved and the new URL is
   * the answer forever. `gone` is temporary (302): the product decision behind
   * it is recent, and a 301 is cached in browsers essentially forever.
   */
  async redirects() {
    /**
     * PUBLIC routes retired with the auction product.
     *
     * Deleting a page does not delete the links to it. These URLs are in
     * notification e-mails, SMS, browser history, bookmarks and whatever
     * Google has indexed, and every one of them would now be a 404. They go
     * to the nearest surface that still answers the same intent.
     *
     * Temporary (302), not permanent: the decision is days old, and a 301 is
     * cached in browsers essentially forever.
     */
    const publicGone: [string, string][] = [
      // Browsing a lot -> browsing the catalogue.
      ["auctions", "annonces"],
      ["properties", "annonces"],
      // Putting a lot up for auction -> publishing an annonce.
      ["sell", "annonces/nouvelle"],
      // Identity verification, the inspector network and the partner portal
      // all existed to make an auction safe to run. Nothing replaces them;
      // the account page is where someone landing on one should end up.
      ["kyc", "account"],
      ["inspector", "account"],
      ["inspectors", "account"],
      ["partners", "account"],
      ["account/inspections", "account"],
    ];

    const gone = [
      "properties", "payouts", "manual-payment", "inspectors", "fraud",
      "waitlist", "kyc-queue", "auctions", "deposits", "characteristics",
    ];
    const renamed: [string, string][] = [
      ["users", "vendeurs"],
      ["sellers", "vendeurs"],
      ["pricing", "offres"],
    ];
    return [
      ...publicGone.flatMap(([from, to]) => [
        { source: `/:locale/${from}`, destination: `/:locale/${to}`, permanent: false },
        { source: `/:locale/${from}/:path*`, destination: `/:locale/${to}`, permanent: false },
      ]),
      // `/admin/payments` the LIST is replaced by `/admin/paiements`. Its
      // sub-paths are not: `/admin/payments/[id]/reject` is still the surface
      // that refuses a caution receipt, reached from the auction settlement
      // screen. Redirecting `:path*` here would have quietly broken the one
      // flow this pivot is careful to keep alive.
      { source: "/:locale/admin/payments", destination: "/:locale/admin/paiements", permanent: true },
      ...renamed.flatMap(([from, to]) => [
        { source: `/:locale/admin/${from}`, destination: `/:locale/admin/${to}`, permanent: true },
        { source: `/:locale/admin/${from}/:path*`, destination: `/:locale/admin/${to}`, permanent: true },
      ]),
      ...gone.flatMap((from) => [
        { source: `/:locale/admin/${from}`, destination: "/:locale/admin", permanent: false },
        { source: `/:locale/admin/${from}/:path*`, destination: "/:locale/admin", permanent: false },
      ]),
    ];
  },

  async headers() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseHost = supabaseUrl.replace(/^https?:\/\//, "");
    const supabaseWs = supabaseHost ? `wss://${supabaseHost}` : "";

    const isDev = process.env.NODE_ENV !== "production";

    // Every host in this policy is here because something on the site loads
    // from it TODAY. It used to also allow OpenStreetMap tiles and its embed
    // iframe (the property map, retired with the auction lot page), Supabase
    // in frame-src (the in-app document viewer, retired with KYC), Google Fonts
    // (the font is self-hosted), three payment gateways the browser never talks
    // to (payments are manual receipts), and picsum / unsplash test hosts. An
    // allowance nothing uses is not harmless: it is a list an injected script
    // gets to choose its exfiltration target from.
    const csp = [
      "default-src 'self'",
      // 'unsafe-inline' stays: Next injects inline bootstrap scripts, and the
      // nonce alternative makes every page dynamic — the catalogue's edge
      // caching is what that would cost. 'unsafe-eval' is DEV-ONLY: React
      // Refresh needs it, a production bundle does not, and it is the one
      // directive that turns a markup injection into arbitrary code.
      // va.vercel-scripts.com serves Vercel Analytics / Speed Insights on
      // preview deployments (production proxies them same-origin).
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com`,
      "style-src 'self' 'unsafe-inline'",
      // Listing photos go through /_next/image (same origin); receipts and
      // signed storage URLs come straight from Supabase.
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self' data:",
      [
        "connect-src 'self'",
        supabaseUrl,
        supabaseWs,
        "https://va.vercel-scripts.com",
        "https://vitals.vercel-insights.com",
      ]
        .filter(Boolean)
        .join(" "),
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      // Nothing on the site embeds a frame any more.
      "frame-src 'none'",
      // `blob:` is required by heic2any, which converts iPhone HEIC photos in
      // a Web Worker spawned from a blob URL — without it the worker is
      // blocked and the upload hangs.
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // camera and geolocation were `(self)` for the KYC selfie and the
            // property map. Neither exists; a permission no feature uses is a
            // permission an injected script can still prompt for.
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Keeps a page opened from this site (or that opened it) from holding
          // a reference to our window — the tabnabbing vector.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
      // Service worker must not be cached aggressively, and needs the
      // Service-Worker-Allowed header to claim the full origin scope.
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      // Seed property images — content-addressable (re-encoded only
      // when the optimization script runs), safe to long-cache.
      // immutable lets the browser skip even the conditional GET on
      // the second visit.
      {
        source: "/properties/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
