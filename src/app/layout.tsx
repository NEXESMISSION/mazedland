import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Cairo } from "next/font/google";
import { getLocale } from "next-intl/server";
import { PWARegister } from "@/components/layout/PWARegister";
import "./globals.css";

// Jakarta only — same family the mazed auto codebase ships with.
// Pairs cleanly with the black + gold palette and reads great at every
// size from a 10px eyebrow to a 36px hero title. Arabic falls back to
// Cairo via html[dir="rtl"] rules in globals.css.
const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

export const metadata: Metadata = {
  metadataBase: SITE_URL ? new URL(SITE_URL) : undefined,
  applicationName: "Batta",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Batta",
    statusBarStyle: "black-translucent",
    startupImage: ["/icons/apple-touch-icon.svg"],
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.svg", sizes: "180x180", type: "image/svg+xml" }],
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      // Tells Next.js this `scroll-behavior: smooth` is intentional and
      // shouldn't be disabled during route transitions.
      data-scroll-behavior="smooth"
      className={`${jakarta.variable} ${cairo.variable} h-full antialiased`}
      // Inline bg kills the white FOUC flash — paints with the very
      // first HTML byte, before globals.css resolves.
      style={{ background: "#0a0a0a" }}
    >
      <body
        className="min-h-full bg-background text-foreground font-sans"
        style={{ background: "#0a0a0a" }}
      >
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
