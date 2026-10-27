import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { ATS_HOSTS } from "../packages/shared/src/extension/urls";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** manifest.json, with the app URL and employer-system hosts filled in at build time. */
function manifest(appUrl: string): Plugin {
  const app = new URL(appUrl);
  const atsMatches = Object.values(ATS_HOSTS)
    .flat()
    .map((h) => `https://${h}/*`);
  return {
    name: "jobbuddy-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: JSON.stringify(
          {
            manifest_version: 3,
            name: "JobBuddy",
            version: "0.2.0",
            description: "Job alerts and application autofill. You always press Submit yourself.",
            icons: { 16: "icon-16.png", 48: "icon-48.png", 128: "icon-128.png" },
            action: { default_popup: "popup.html", default_title: "JobBuddy" },
            background: { service_worker: "background.js", type: "module" },
            // Minimal: settings and session, the 15-minute alert check, notifications, and
            // activeTab + scripting so "Fill this page" works on any site the user is on
            // (only when they press it; no access to other sites).
            permissions: ["storage", "alarms", "notifications", "activeTab", "scripting"],
            // The app (all requests go through it) and the employer systems it fills.
            host_permissions: [`${app.origin}/*`, ...atsMatches],
            content_scripts: [
              {
                matches: atsMatches,
                js: ["content.js"],
                all_frames: true,
                run_at: "document_idle",
              },
            ],
          },
          null,
          2,
        ),
      });
    },
  };
}

// Builds the MV3 extension into dist/. Load dist/ with "Load unpacked" in chrome://extensions.
// The content script is built separately (vite.content.config.ts): it must be one plain file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root("."), "VITE_");
  return {
    publicDir: "public",
    plugins: [manifest(env.VITE_APP_URL || "http://localhost:3000")],
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
  };
});
