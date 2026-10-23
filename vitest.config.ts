import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["./vitest.global-setup.ts"],
    // Fails a test file that lets a real Warcraft Logs / Blizzard / Raider.IO request escape.
    setupFiles: ["./src/test/external-api-guard.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
