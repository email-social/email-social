import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// End-to-end tests: the built web client in Chromium (playwright-core) against the bridge.
export default defineConfig({
  resolve: {
    alias: { "@email-social/es-core": fileURLToPath(new URL("../es-core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test-e2e/**/*.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
