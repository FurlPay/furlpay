import { defineConfig, devices } from "@playwright/test";

// ---------------------------------------------------------------------------
// Browser QA for the support surface.
//
// WHY THE DEV SERVER, AND WHY THAT IS NOT A WEAKENING
//
// Authenticated tests need two DISTINCT identities (cross-user isolation is the
// whole point of §8). The app's real account-creation path is the OTP flow:
//   POST /api/auth/otp/start  -> in mock mode, echoes `devCode`
//   POST /api/auth/otp/check  -> findOrCreateUserByIdentityDurable + session
//
// That is the production sign-in flow, not a bypass. Mock mode simply generates
// the code locally instead of calling Twilio, and `assertLiveInProduction()` in
// lib/auth/otp.ts REFUSES to run mock OTP when NODE_ENV=production. So the only
// place two real identities can be minted is a non-production server.
//
// Nothing here relaxes that guard. No production backdoor, no seeded admin, no
// `ALLOW_GUEST_LOGIN`, no `requireRole` bypass, no new route. The alternative —
// making mock OTP or guest login reachable under NODE_ENV=production — is
// exactly what must not happen, so the tests move instead of the guards.
//
// PRODUCTION PARITY: every spec that does not need a session also runs against
// `next start` (the real production bundle). Set E2E_BASE_URL to point the suite
// at an already-running server and the webServer below is skipped:
//   npm run build && npx next start -p 8792
//   E2E_BASE_URL=http://127.0.0.1:8792 npx playwright test --grep-invert @auth
// ---------------------------------------------------------------------------

const PORT = Number(process.env.E2E_PORT ?? 8793);
const externalBaseUrl = process.env.E2E_BASE_URL;
const baseURL = externalBaseUrl ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Artifacts stay out of the repo — see .gitignore.
  outputDir: "./test-results",
  // Deterministic in CI, convenient locally. No local-only paths anywhere.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL,
    headless: true,
    // Artifacts only on failure, so a green run leaves nothing behind.
    screenshot: "only-on-failure",
    video: "off",
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // A real mobile profile, not just a narrow window: touch + device scale
    // factor change layout and hit targets.
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],

  // Skipped when E2E_BASE_URL is supplied (the production-parity run).
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `http://127.0.0.1:${PORT}/support`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: {
          // Mock OTP (the default) is what lets the suite mint real identities.
          // Explicit rather than inherited so the intent is visible.
          INTEGRATION_MODE: "mock",
          // A 32+ byte secret so lib/session.ts will sign. Test-only value; it
          // is not a credential for anything and grants nothing outside this
          // ephemeral dev server.
          FURLPAY_SESSION_SECRET:
            process.env.FURLPAY_SESSION_SECRET ?? "e2e_only_session_secret_not_a_real_credential_0123456789",
        },
      },
});
