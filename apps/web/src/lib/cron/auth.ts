// ---------------------------------------------------------------------------
// Cron endpoint authentication.
//
// THE PROBLEM THIS SOLVES, stated bluntly: a scheduled job is a mutation
// endpoint that a scheduler calls over plain HTTP. Vercel Cron issues an
// ordinary GET to a public URL. If the route does not authenticate, then
// "reconcile every user's orders" and "retry every dead-lettered event" are
// operations any stranger can trigger at any rate they like — and the fact that
// a cron endpoint is not linked from anywhere is not a control.
//
// TWO ACCEPTED CREDENTIALS, and both are checked in constant time:
//
//   1. `Authorization: Bearer <CRON_SECRET>` — what Vercel Cron sends when
//      CRON_SECRET is set on the project. This is the production path.
//   2. `x-furlpay-cron-key: <FURLPAY_CRON_SECRET>` — for an external scheduler
//      or a manual operator run, so cron does not have to be Vercel's.
//
// FAIL CLOSED WHEN UNCONFIGURED. With no secret set, every request is refused
// rather than allowed. The opposite default — "no secret means no check" — is
// how these endpoints end up open in production: the secret is added later,
// and nobody notices it was never there.
//
// `x-vercel-cron` IS NOT A CREDENTIAL. Vercel sets that header on its own
// requests, and it is tempting to treat it as proof of origin. It is a header;
// anyone can send it. It is read here only for LOGGING, never for authorisation.
// ---------------------------------------------------------------------------

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export type CronAuthResult = { ok: true; caller: "vercel-cron" | "external" } | { ok: false; res: NextResponse };

/** Constant-time string compare that does not leak length through a throw. */
function secureEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on differing lengths, which would both leak the
  // length and turn a failed auth into a 500.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Authenticate a scheduled invocation.
 *
 * Returns a 401 response rather than throwing, so a route can `return auth.res`
 * in the same shape as `requireUser`.
 */
export function requireCron(req: NextRequest): CronAuthResult {
  const vercelSecret = (process.env.CRON_SECRET ?? "").trim();
  const externalSecret = (process.env.FURLPAY_CRON_SECRET ?? "").trim();

  if (!vercelSecret && !externalSecret) {
    // Unconfigured. Refuse — do not fall through to "allow".
    return {
      ok: false,
      res: NextResponse.json(
        {
          error: "cron_not_configured",
          detail:
            "No cron secret is configured on this deployment. Set CRON_SECRET (Vercel Cron) or " +
            "FURLPAY_CRON_SECRET (external scheduler). Scheduled jobs are refused until then.",
        },
        { status: 503 }
      ),
    };
  }

  const bearer = req.headers.get("authorization") ?? "";
  if (vercelSecret && bearer.startsWith("Bearer ")) {
    if (secureEquals(bearer.slice(7), vercelSecret)) return { ok: true, caller: "vercel-cron" };
  }

  const headerKey = req.headers.get("x-furlpay-cron-key") ?? "";
  if (externalSecret && headerKey) {
    if (secureEquals(headerKey, externalSecret)) return { ok: true, caller: "external" };
  }

  return {
    ok: false,
    res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}

/** Whether a cron secret exists at all — for the readiness endpoint. */
export function cronConfigured(): boolean {
  return Boolean((process.env.CRON_SECRET ?? "").trim() || (process.env.FURLPAY_CRON_SECRET ?? "").trim());
}
