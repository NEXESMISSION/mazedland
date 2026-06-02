import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { PWARegister } from "@/components/layout/PWARegister";
import { Suspense } from "react";
import { ClientLogger } from "@/components/dev/ClientLogger";
import { ClientErrorReporter } from "@/components/observability/ClientErrorReporter";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

// Jakarta only — same family the mazed auto codebase ships with.
// Pairs cleanly with the black + gold palette and reads great at every
// size from a 10px eyebrow to a 36px hero title.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  // French-only site: the "latin" subset already covers all French accents
  // (é è ê à ç …, U+00xx). "latin-ext" only adds Eastern-European glyphs we
  // never render, so dropping it ~halves the font payload on every page.
  subsets: ["latin"],
  // Weight 300 was used in exactly one spot (switched to 400); the rest of
  // the UI lives in 400/500/600/700/800. Fewer weights = fewer font files.
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  applicationName: "Batta",
  title: {
    default: "Batta — Real Estate Auctions",
    template: "%s · Batta",
  },
  description:
    "Tunisia's first dedicated real-estate auction platform. Transparency. Speed. Trust.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Batta",
    statusBarStyle: "default",
    startupImage: ["/logo-square.png"],
  },
  icons: {
    icon: [{ url: "/logo-square.png", type: "image/png" }],
    apple: [{ url: "/logo-square.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/logo-square.png"],
  },
  openGraph: {
    title: "Batta — Real Estate Auctions",
    description:
      "Tunisia's first dedicated real-estate auction platform. Transparency. Speed. Trust.",
    type: "website",
    siteName: "Batta",
    images: [
      {
        url: "/logo-square.png",
        width: 1104,
        height: 1104,
        alt: "Batta — Real Estate Auctions",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: "Batta — Real Estate Auctions",
    description: "Tunisia's first dedicated real-estate auction platform.",
    images: ["/logo-square.png"],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "light",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Origin of the Supabase project so the browser can warm a TLS +
  // HTTP/2 connection before we issue the first auth/db/storage call.
  // Skipped when unset (dev with `.env.example` only).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseOrigin = supabaseUrl
    ? (() => { try { return new URL(supabaseUrl).origin; } catch { return null; } })()
    : null;

  return (
    <html
      lang="fr"
      dir="ltr"
      // Tells Next.js this `scroll-behavior: smooth` is intentional and
      // shouldn't be disabled during route transitions.
      data-scroll-behavior="smooth"
      className={`${jakarta.variable} h-full antialiased`}
      // Inline bg paints with the first HTML byte, before globals.css
      // resolves — keeps the initial paint on-brand.
      style={{ background: "#ffffff" }}
    >
      <head>
        {/*
          Warm TCP + TLS + HTTP/2 connections to origins we hit early
          on every page so the first auth/db/storage call saves the
          ~100–250 ms cold-handshake. preconnect is the strong form
          (full handshake); dns-prefetch is the cheap fallback for
          browsers that ignore preconnect (mostly older WebKit).
        */}
        {supabaseOrigin && (
          <>
            <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        )}
        {/* OpenStreetMap tile servers — only hit on property-detail
            pages, but pre-warming costs ~0 and shaves perceived load
            time on the map iframe. */}
        <link rel="dns-prefetch" href="https://tile.openstreetmap.org" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Preload the splash-screen wordmark so it paints before any
            JS hydrates. AVIF is ~4 KB; the second preload covers the
            handful of browsers (older Safari, Firefox without AVIF) that
            need WebP. The `imagesrcset` makes the browser pick exactly
            one — no double download. */}
        <link
          rel="preload"
          as="image"
          href="/logo.avif"
          type="image/avif"
          fetchPriority="high"
        />
        <link
          rel="preload"
          as="image"
          href="/logo.webp"
          type="image/webp"
          fetchPriority="high"
        />
      </head>
      <body
        className="min-h-full bg-background text-foreground font-sans"
        style={{ background: "#ffffff" }}
      >
        {children}
        <PWARegister />
        {/* Ships uncaught client errors + unhandled rejections to the server
            log sink — pairs with instrumentation.ts (server errors) for a
            single, unified observability stream. */}
        <ClientErrorReporter />
        {/* Vercel web analytics + Core Web Vitals (zero-config, no DSN).
            Real-user performance + traffic without a third-party tag. */}
        <Analytics />
        <SpeedInsights />
        <Suspense fallback={null}>
          <ClientLogger />
        </Suspense>
      </body>
    </html>
  );
}
