import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: new URL("../../apps/web/.env.local", import.meta.url) });

export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
