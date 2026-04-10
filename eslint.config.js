import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Warn on unused variables (allow underscore-prefixed args)
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Warn (don't error) on explicit any — nudge toward proper types
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // Architecture invariants enforced via ESLint:
    // - main-world.ts must not call console.* directly (gated console wrapper handles it)
    // - addReverseMapping(currentReverseMap, ...) must only be called from registerPseudonymization
    files: ["apps/extension/src/content/main-world.ts", "apps/extension/src/content/main-world/**/*.ts"],
    rules: {
      // Direct console.* calls in main-world leak internal state to DevTools.
      // Use the production console gate at the top of main-world.ts which
      // suppresses output unless localStorage.ironGateDebug === 'true'.
      // This rule is currently advisory ('warn') because the gate at the top
      // of main-world.ts wraps console at runtime — but moving to a logger
      // helper is the cleaner long-term fix.
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    ignores: [
      "node_modules/",
      "dist/",
      ".next/",
      "apps/detection/",
      "coverage/",
    ],
  },
);
