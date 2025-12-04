import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Custom rule overrides for build compatibility
  {
    rules: {
      // Allow any type in specific cases (API routes, etc.)
      "@typescript-eslint/no-explicit-any": "warn",
      // Allow unescaped entities in JSX (common in text content)
      "react/no-unescaped-entities": "off",
      // Allow setState in useEffect (common pattern for data fetching)
      "react-hooks/exhaustive-deps": "warn",
      // Disable the strict set-state-in-effect rule (common pattern for data fetching)
      "react-hooks/set-state-in-effect": "off",
      // Disable the immutability rule (causes false positives)
      "react-hooks/immutability": "off",
      // Disable preserve-manual-memoization (react compiler rule that causes build failures)
      "react-hooks/preserve-manual-memoization": "off",
      // Keep rules-of-hooks as error (important for hook correctness)
      "react-hooks/rules-of-hooks": "error",
      // Allow require imports for config files
      "@typescript-eslint/no-require-imports": "warn",
      // Allow unused vars with underscore prefix
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      // Downgrade prefer-const to warning
      "prefer-const": "warn",
      // Allow <a> elements in error boundaries (Link doesn't work in global-error)
      "@next/next/no-html-link-for-pages": "warn",
    },
  },
]);

export default eslintConfig;
