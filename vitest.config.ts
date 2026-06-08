import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Two test projects share this config:
//
//   • "unit" — the pure, framework-free logic in src/lib/** (money math, IBAN
//     validation, search sanitization, rejection encoding, the same-origin
//     guard) — the bits where a silent regression would cost real money or open
//     a security hole. Node-only, fast, no external services. This is what
//     `pnpm test` runs (CI's existing unit gate).
//
//   • "rpc" — money/auction RPC INTEGRATION tests in tests/rpc/**. These hit a
//     REAL local Supabase Postgres (brought up by `supabase start`) so the
//     SECURITY DEFINER PL/pgSQL RPCs that move money execute with their real
//     grants, RLS, and triggers. They need the local stack's URL + keys in env
//     and Docker running; a bare postgres won't apply supabase/migrations. Run
//     them with `pnpm test:rpc` (which scopes to this project). They are
//     deliberately NOT in the default `pnpm test` so the unit gate stays
//     hermetic and infra-free.
//
// `pnpm test`      → vitest run --project unit   (see package.json)
// `pnpm test:rpc`  → vitest run --project rpc
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Run test FILES serially. The RPC suite contends on per-seller advisory
    // locks and shares one local DB, so parallel files would race fixtures.
    // The unit project is pure functions, so serial files cost nothing there.
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
          // Keep the run snappy in CI; these are pure functions.
          testTimeout: 5_000,
        },
      },
      {
        test: {
          name: "rpc",
          environment: "node",
          include: ["tests/rpc/**/*.test.ts"],
          // RPC calls + sign-ins + a 2s anti-snipe cooldown wait → generous
          // per-test budget. Run serially: the suite contends on per-seller
          // advisory locks and shares one local DB, so parallel files would
          // race each other's fixtures.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
