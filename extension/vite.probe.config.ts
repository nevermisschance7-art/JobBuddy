import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// The form code as one script for the "Probe forms" workflow (not part of the extension).
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist-probe",
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL("probe/probe.ts", import.meta.url)),
      formats: ["iife"],
      name: "JobBuddyProbeBundle",
      fileName: () => "probe.js",
    },
  },
});
