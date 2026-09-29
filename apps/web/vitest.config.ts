import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Vitest config for server-side unit / logic tests (no jsdom). Resolves the
// "@/..." path alias the app uses so specs import the REAL production modules.
// Runs *.spec.ts. HTTP-integration and DB-integration specs that need a live
// Postgres are tagged and skipped unless a database is configured.
export default defineConfig({
  test: {
    environment: "node",
    // .tsx is included so React components can be tested. Those specs opt into
    // a DOM per-file with a `@vitest-environment jsdom` docblock rather than
    // switching the default: the other ~2000 specs are server-side logic and
    // would only pay jsdom's startup cost for nothing.
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    globals: false,
    // Vitest's default is 5s. A family of invariant tests here WALKS THE WHOLE
    // SOURCE TREE — the DOM-sink inventory, the custody-claims sweep, the
    // booking-provider check, the FURL mint uniqueness check — and their runtime
    // scales with the repository and with how loaded the machine is. They
    // individually take 5-7s and were timing out only when 300 test files
    // competed for the same disk.
    //
    // This raises the BUDGET, never an assertion: every one of those tests
    // asserts exactly what it did before. The alternative — re-running until the
    // machine happens to be idle — is how a real regression eventually gets
    // dismissed as "just the flaky scan test".
    testTimeout: 30_000,
  },
  // Compiles JSX for the .tsx specs. The node-environment specs are unaffected
  // — the plugin only transforms files that actually contain JSX.
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
