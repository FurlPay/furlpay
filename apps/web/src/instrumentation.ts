// Next.js server start hook. Runs once per server process before any request.
//
// Boot-time configuration that must be present for the process to be safe to
// serve traffic is checked here, so a misconfigured production deployment
// refuses to start instead of starting in a weaker mode. Today that is the
// admin identity: without FURLPAY_ADMIN_EMAIL there is no fallback admin
// (lib/adminIdentity.ts), and production must not boot guessing.
//
// Skipped during `next build` (NEXT_PHASE=phase-production-build): the build
// environment is not the runtime environment and must not need runtime secrets.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertBootConfig } = await import("./lib/bootConfig");
  try {
    assertBootConfig();
  } catch (e) {
    console.error(`[boot] refusing to start: ${(e as Error).message}`);
    process.exit(1);
  }
}

// Unhandled server errors, for the admin dashboard (lib/analytics/telemetry.ts).
// Records the route PATTERN, the error class and Next's digest — never the
// message or the concrete URL, either of which can carry user input. Errors a
// handler catches and turns into a 4xx/5xx response are not seen here; this is
// the "something threw" signal, and the dashboard labels it that way.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string }
): Promise<void> {
  const { recordServerError } = await import("./lib/analytics/telemetry");
  const e = err as { name?: unknown; digest?: unknown };
  await recordServerError({
    route: context.routePath || "unknown",
    routeType: context.routeType || "unknown",
    method: request.method || "GET",
    error: typeof e?.name === "string" ? e.name : "Error",
    digest: typeof e?.digest === "string" ? e.digest : undefined,
  });
}
