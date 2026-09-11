import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for the pure, framework-free logic in src/lib/** — the pieces
// where a silent regression costs money or opens a hole: pricing of listing
// products, IBAN validation, search sanitisation, the same-origin guard, the
// redirect guard, the health dead-man's-switch. Node-only, no external
// services. `pnpm test` runs them.
//
// There used to be a second project, "rpc", of integration tests against a
// local Supabase. Every one of its ten files exercised an auction RPC —
// place_bid, tick_auctions, request_payout, seller_earnings… — all dropped with
// the auction product. A suite that cannot pass reads as coverage in a file
// listing and protects nothing, so it is gone rather than kept red.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    fileParallelism: false,
    projects: [
      {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          testTimeout: 5_000,
        },
      },
    ],
  },
});
