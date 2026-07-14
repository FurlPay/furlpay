import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vitest config for server-side unit / logic tests (no jsdom). Resolves the
// "@/..." path alias the app uses so specs import the REAL production modules.
// Runs *.spec.ts. HTTP-integration and DB-integration specs that need a live
// Postgres are tagged and skipped unless a database is configured.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
