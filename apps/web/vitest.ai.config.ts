import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only for the manual "AI check" workflow: calls real models. Never part of `pnpm test`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["ai-check/**/*.check.ts"], testTimeout: 180_000 },
});
