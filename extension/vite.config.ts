import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Builds the MV3 extension into dist/. Load dist/ with "Load unpacked" in chrome://extensions.
export default defineConfig({
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: root("src/background.ts"),
        popup: root("popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
