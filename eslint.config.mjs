import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/prisma/contract.d.ts",
    "src/prisma/contract.json",
    "migrations/**",
    // Local agent tooling (skills / worktrees) — not project source.
    ".claude/**",
  ]),
]);

export default eslintConfig;
