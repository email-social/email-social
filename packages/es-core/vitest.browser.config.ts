import { defineConfig } from "vitest/config";

// Browser smoke test: loads the Vite bundle in Chromium (playwright-core).
export default defineConfig({
  test: {
    include: ["test-browser/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
