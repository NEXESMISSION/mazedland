import localFont from "next/font/local";

// Both fonts are SELF-HOSTED (next/font/local), never next/font/google: the
// build used to fetch from Google and fail intermittently on flaky networks,
// and the CSP only allows fonts from 'self'.

// Plus Jakarta Sans — one latin-subset variable woff2 (~27 KB) covers weights
// 400–800, the only range the UI uses; latin already covers French accents.
export const jakarta = localFont({
  src: "./fonts/PlusJakartaSans-latin.woff2",
  variable: "--font-jakarta",
  weight: "400 800",
  display: "swap",
});

// Cairo — the Arabic-subset variable woff2 (~31 KB, OFL-1.1, from
// @fontsource-variable/cairo 5.3.0). It carries Arabic glyphs only: on an
// Arabic page Latin text and digits fall through to Jakarta, which is what
// globals.css's RTL font stack relies on. Not preloaded — a French page never
// uses it, and the Arabic page swaps in from a same-origin request.
export const cairo = localFont({
  src: "./fonts/Cairo-arabic.woff2",
  variable: "--font-cairo",
  weight: "200 1000",
  display: "swap",
  preload: false,
});
