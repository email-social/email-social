import { defineConfig } from "vite";

// The web client is served by es-bridge from 127.0.0.1; everything it needs is in this bundle.
export default defineConfig({
  base: "./",
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
