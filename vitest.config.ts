import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit-test config. We test the pure, framework-free logic in src/lib/**
// (money math, IBAN validation, search sanitization, rejection encoding,
// the same-origin guard) — the bits where a silent regression would cost
// real money or open a security hole. React component / route-handler
// integration tests would need jsdom + a Supabase mock and are tracked
// separately; this config deliberately stays node-only and fast.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Keep the run snappy in CI; these are pure functions.
    testTimeout: 5_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
