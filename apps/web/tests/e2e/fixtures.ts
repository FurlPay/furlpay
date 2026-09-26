import { test as base, expect, type Page, type APIRequestContext, type BrowserContext } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared fixtures.
//
// `signIn` uses the app's REAL authentication flow — OTP start, then OTP check —
// against a dev server where OTP runs in mock mode and echoes the code. No
// production guard is touched and no test-only route exists: distinct emails
// produce distinct accounts through `findOrCreateUserByIdentityDurable`, which
// is the same path Google/Apple/passkey sign-in uses.
//
// `observe` collects console errors, page exceptions, failed requests and CSP
// violations. Expected security responses (401/403/404/429 on probes) are NOT
// failures and are filtered by the caller, so a test that deliberately provokes
// a 401 does not have to disable the whole observer.
// ---------------------------------------------------------------------------

export interface Observed {
  consoleErrors: string[];
  pageErrors: string[];
  /** Requests the browser itself failed to complete (DNS, abort, blocked). */
  failedRequests: { url: string; failure: string }[];
  /** Every response, so a test can assert on status codes it expects. */
  responses: { url: string; status: number }[];
  cspViolations: string[];
}

export function observe(page: Page): Observed {
  const o: Observed = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    responses: [],
    cspViolations: [],
  };

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") o.consoleErrors.push(text);
    // Chromium reports CSP blocks as console errors with this wording.
    if (/Content Security Policy|Refused to/i.test(text)) o.cspViolations.push(text);
  });
  page.on("pageerror", (err) => o.pageErrors.push(err.message));
  page.on("requestfailed", (req) =>
    o.failedRequests.push({ url: req.url(), failure: req.failure()?.errorText ?? "unknown" })
  );
  page.on("response", (res) => o.responses.push({ url: res.url(), status: res.status() }));

  return o;
}

/**
 * Console noise that is not a defect.
 *
 * React's hydration warnings are deliberately NOT in this list — catching those
 * is a stated goal of this suite.
 */
const IGNORABLE_CONSOLE = [
  // Next.js dev-server informational noise.
  /\[Fast Refresh\]/i,
  /Download the React DevTools/i,
  // Third-party embeds are not loaded in tests; their absence is expected.
  /net::ERR_BLOCKED_BY_CLIENT/i,
  // A deliberate 4xx from a security probe surfaces here as a console error
  // because fetch logs it. The test asserts the STATUS separately.
  /Failed to load resource: the server responded with a status of 4\d\d/i,
  /Failed to load resource: the server responded with a status of 429/i,
];

export function realConsoleErrors(o: Observed): string[] {
  return o.consoleErrors.filter((e) => !IGNORABLE_CONSOLE.some((re) => re.test(e)));
}

/** Hydration and render failures, which must never appear. */
export function hydrationErrors(o: Observed): string[] {
  const all = [...o.consoleErrors, ...o.pageErrors];
  return all.filter((e) =>
    /hydrat|did not match|Minified React error|Text content does not match/i.test(e)
  );
}

export interface TestIdentity {
  email: string;
  userId: string;
}

/**
 * Sign a browser context in as a fresh identity via the real OTP flow.
 *
 * Returns the identity so cross-user tests can assert on distinct user ids.
 */
export async function signIn(
  request: APIRequestContext,
  context: BrowserContext,
  email: string
): Promise<TestIdentity> {
  const start = await request.post("/api/auth/otp/start", {
    data: { to: email, channel: "email" },
  });
  if (!start.ok()) {
    throw new Error(
      `otp/start failed (${start.status()}): ${await start.text()}\n` +
        "The dev server must run with INTEGRATION_MODE=mock; mock OTP is refused under NODE_ENV=production by design."
    );
  }
  const { devCode } = (await start.json()) as { devCode?: string };
  if (!devCode) {
    throw new Error("otp/start returned no devCode — OTP is not in mock mode, so no code can be read.");
  }

  const check = await request.post("/api/auth/otp/check", {
    data: { to: email, code: devCode, channel: "email", login: true },
  });
  if (!check.ok()) {
    throw new Error(`otp/check failed (${check.status()}): ${await check.text()}`);
  }

  // Move the session cookie from the API context into the browser context.
  const cookies = await request.storageState();
  await context.addCookies(
    cookies.cookies.map((c) => ({ ...c, url: undefined, domain: c.domain, path: c.path }))
  );

  // /api/profile returns the user fields at the top level (id, name, email…),
  // not nested under `user`.
  const profile = await request.get("/api/profile");
  if (!profile.ok()) throw new Error(`profile failed (${profile.status()}) — session did not take`);
  const body = (await profile.json()) as { id?: string; email?: string };
  if (!body.id) throw new Error("profile returned no id — the session is not resolving to an account");
  return { email, userId: body.id };
}

/** A unique email per test run, so identities never collide across retries. */
export function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

export const test = base;
export { expect };
