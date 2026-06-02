// Next 16's eslint-config-next ships native ESLint flat-config arrays, so we
// import them directly instead of bridging the legacy .eslintrc format through
// FlatCompat (@eslint/eslintrc). The FlatCompat path crashes on this toolchain
// ("Converting circular structure to JSON" while validating the next/react
// plugin configs); the native flat configs sidestep that entirely.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    linterOptions: {
      // Some disable directives went stale when the rule set changed; surface
      // them as warnings to clean up over time rather than hard-failing CI.
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      // react-hooks v7 (bundled with Next 16) adds brand-new ADVISORY rules
      // with high false-positive rates on valid, shipped patterns — the
      // mount-effect setState idiom, reading a ref/Date during render for a
      // transition, etc. Keep them visible as warnings instead of blocking
      // CI; we revisit them case-by-case rather than mass-rewriting working
      // hooks (which risks real regressions for a debatable lint opinion).
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // Next performance advisories — real, but not correctness. The handful
      // of raw <a>/<img> uses are deliberate (error/not-found pages that must
      // hard-navigate, blob-URL image previews).
      "@next/next/no-html-link-for-pages": "warn",
      "@next/next/no-img-element": "warn",
      // The French/Arabic UI copy is full of apostrophes and quotes; escaping
      // them in JSX hurts readability for zero user-facing benefit.
      "react/no-unescaped-entities": "off",
      // Allow intentionally-unused args/vars when prefixed with "_".
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "desing/**", "scripts/**"],
  },
];

export default eslintConfig;
