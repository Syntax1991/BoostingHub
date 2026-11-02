import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    // Every test lives under tests/: unit/ (no database), integration/ (database or
    // real subprocesses). fixtures/, helpers/ and setup/ hold shared test code.
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./tests/setup/global-setup.ts"],
    // Fails a test file that lets a real Warcraft Logs / Blizzard / Raider.IO request escape.
    setupFiles: ["./tests/setup/external-api-guard.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
    },
  },
});
