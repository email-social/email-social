import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Deterministic tests only: fail loudly if a test forgets to inject time.
    sequence: { shuffle: false },
  },
});
