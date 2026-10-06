import type { Metadata, Viewport } from "next";
import { siteUrl } from "@/lib/siteUrl";
import "./globals.css";

// A pass-through. <html> and <body> live in [locale]/layout.tsx, the first
// layout that knows the locale — so `lang` and `dir` are right on the first
// byte for /fr and /ar alike, without reading request headers here (which
// would make every page dynamic). not-found.tsx and global-error.tsx, the two
// pages outside [locale], render their own <html>.
//
// The metadata below is the fallback for those two pages; [locale]/layout.tsx
// overrides the text per locale.

// Null on a local build, which leaves metadataBase to Next's own default.
const SITE_URL = siteUrl();

export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  applicationName: "Mazed Immo",
  title: {
    default: "Mazed Immo — Petites annonces immobilières en Tunisie",
    template: "%s · Mazed Immo",
  },
  description:
    "Terrains, maisons, appartements et locaux partout en Tunisie. Le prix affiché, le vendeur au bout du fil.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mazed Immo",
    statusBarStyle: "default",
    startupImage: ["/logo-square.png"],
  },
  icons: {
    icon: [
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon-64.png"],
  },
  openGraph: {
    title: "Mazed Immo — Petites annonces immobilières en Tunisie",
    description:
      "Terrains, maisons, appartements et locaux partout en Tunisie. Le prix affiché, le vendeur au bout du fil.",
    type: "website",
    siteName: "Mazed Immo",
    images: [
      {
        // 1200x630 — the ratio every social preview crops to. A square was
        // being letterboxed by each of them into a different accidental crop.
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Mazed Immo — Petites annonces immobilières en Tunisie",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Mazed Immo — Petites annonces immobilières en Tunisie",
    description: "Terrains, maisons, appartements et locaux partout en Tunisie.",
    images: ["/og.png"],
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
