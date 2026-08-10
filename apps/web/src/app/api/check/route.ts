import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { normalizeHandle, isHandleAvailable } from "@/lib/walletHandles";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/check?tag=<name> — is this FurlPay Wallet handle available?
//
// Public and unauthenticated (it powers keystroke-by-keystroke feedback on the
// /wallet page), so it is rate-limited per IP. The response shape is fixed:
//   { available: boolean, normalized?: string, error?: string }
// The client treats a truthy `available` + `normalized` as claimable and shows
// `error` otherwise.
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  // Generous enough for live typing (debounced client-side), tight enough that
  // the handle namespace can't be enumerated at speed from one IP.
  const limited = await rateLimitOr429(req, "wallet.check", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const tag = req.nextUrl.searchParams.get("tag") ?? "";
  const v = normalizeHandle(tag);
  if (!v.ok || !v.normalized) {
    return NextResponse.json({ available: false, error: v.error });
  }

  let available: boolean;
  try {
    available = await isHandleAvailable(v.normalized);
  } catch {
    // Never claim availability we couldn't verify — fail closed.
    return NextResponse.json(
      { available: false, error: "Could not check availability." },
      { status: 503 }
    );
  }

  return NextResponse.json({
    available,
    normalized: v.normalized,
    ...(available ? {} : { error: `@${v.normalized} is taken` }),
  });
}
