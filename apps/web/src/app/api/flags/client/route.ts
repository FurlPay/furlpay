import { NextRequest, NextResponse } from "next/server";
import { optionalUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { CLIENT_FLAGS, resolveClientFlag, type ClientFlag } from "@/lib/clientFlags/registry";

export const dynamic = "force-dynamic";

// GET /api/flags/client — the flag payload a mobile build reads at launch.
//
// UNAUTHENTICATED IS A SUPPORTED CASE, not a fallback. Flags are read on the
// very first screen, before sign-in, and a login screen that has to wait for a
// session it does not have yet is a login screen that hangs. Anonymous callers
// get the same registry resolved against their install id.
//
// THE INSTALL ID IS UNTRUSTED AND THAT IS FINE. A user who forges it lands in a
// different rollout bucket — which is exactly what "flip the flag on my own
// device" already achieves, and buys nothing, because every screen behind a
// flag re-authorises server-side. It is length-capped only so it cannot be used
// to push unbounded strings through the hash.
const MAX_SUBJECT = 128;

export async function GET(req: NextRequest) {
  // Public and called on every cold start, so it gets a budget of its own
  // rather than leaning on the mutating-request baseline in middleware.
  const limited = await rateLimitOr429(req, "flags.client", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const auth = await optionalUser(req);
  if (auth.kind === "rejected") return auth.res;

  // A signed-in user keeps one bucket across reinstalls and devices; that is
  // the point of preferring the user id. The install id only carries the
  // rollout for someone we cannot yet name.
  const installId = (req.nextUrl.searchParams.get("installId") ?? "").slice(0, MAX_SUBJECT);
  const subject = auth.kind === "user" ? auth.account.user.id : installId || "anonymous";

  const flags: Record<string, boolean> = {};
  for (const flag of CLIENT_FLAGS as readonly ClientFlag[]) {
    flags[flag] = resolveClientFlag(flag, subject).enabled;
  }

  return NextResponse.json(
    {
      flags,
      // Lets the client tell "server said everything is off" apart from "we
      // never reached the server and these are baked-in defaults" — two states
      // that look identical in a UI and need different debugging.
      resolvedAt: new Date().toISOString(),
      identified: auth.kind === "user",
    },
    {
      // Short, and private: the payload is per-subject, so a shared CDN cache
      // would hand one user's rollout to another.
      headers: { "Cache-Control": "private, max-age=60" },
    },
  );
}
