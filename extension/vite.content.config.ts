import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The content script: one self-contained file (content scripts can't load ES modules).
// Runs after the main build and adds content.js to dist/.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("src/content/index.ts", import.meta.url)),
      formats: ["iife"],
      name: "JobBuddyContent",
      fileName: () => "content.js",
    },
  },
});
