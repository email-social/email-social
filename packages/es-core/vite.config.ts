import { defineConfig } from "vite";

// Library build for browsers and Node: one ES module, no Node built-ins.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: () => "es-core.js",
    },
  },
});
