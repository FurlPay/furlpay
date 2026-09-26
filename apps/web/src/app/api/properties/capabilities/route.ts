import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import {
  PAYMENT_LABEL,
  acceptsUsdc,
  unknownAttribute,
  type Attributed,
  type PaymentCapability,
} from "@/lib/hotels/provenance";
import { lookupCapabilities } from "@/lib/places/capabilities";

// ---------------------------------------------------------------------------
// GET /api/properties/capabilities?placeIds=a,b,c
//
// FurlPay's OWN answer to "can this property actually take USDC?".
//
// This exists as a separate endpoint on purpose. It must never be folded into
// the Places response, because the moment the two travel together somebody
// reads a payment capability as though Google asserted it. Google has no such
// field and no opinion on the matter; this is FurlPay's commercial data.
//
// An unknown place returns `unknown` — NOT false. "We never checked" and "we
// checked and it cannot" are different facts, and collapsing them into one
// boolean is how a map ends up quietly claiming that a hotel refuses USDC
// when nobody ever asked it.
// ---------------------------------------------------------------------------

/** Google place ids are opaque; bound the shape and the batch size. */
const Query = z.object({
  placeIds: z
    .string()
    .min(1)
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .refine((a) => a.length > 0, "placeIds must contain at least one id")
    .refine((a) => a.length <= 50, "at most 50 place ids per request")
    .refine((a) => a.every((id) => /^[A-Za-z0-9_-]{4,255}$/.test(id)), "malformed place id"),
});

export interface CapabilityRow {
  placeId: string;
  capability: PaymentCapability;
  label: string;
  acceptsUsdc: boolean;
  supportedAssets: string[];
  checkoutAvailable: boolean;
  /** Where the answer came from, so the UI can hedge honestly. */
  source: string;
  observedAt: string;
}

function toRow(placeId: string, a: Attributed<PaymentCapability>): CapabilityRow {
  const usdc = acceptsUsdc(a);
  return {
    placeId,
    capability: a.value,
    label: PAYMENT_LABEL[a.value],
    acceptsUsdc: usdc,
    supportedAssets: usdc ? ["USDC"] : [],
    checkoutAvailable: a.value === "verified_usdc" || a.value === "furlpay_settlement_available",
    source: a.source,
    observedAt: typeof a.observedAt === "string" ? a.observedAt : new Date(a.observedAt).toISOString(),
  };
}

export async function GET(req: NextRequest) {
  // Public, unauthenticated read: it reveals only whether FurlPay supports a
  // property, but it is still a lookup someone could enumerate.
  const limited = await rateLimitOr429(req, "properties.capabilities", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = Query.safeParse({ placeIds: req.nextUrl.searchParams.get("placeIds") ?? "" });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  const ids = parsed.data.placeIds;
  const known = await lookupCapabilities(ids);

  const rows = ids.map((id) => {
    const found = known.get(id);
    // No record -> `unknown`, with the attribution that says so.
    return toRow(id, found ?? (unknownAttribute<PaymentCapability>() as Attributed<PaymentCapability>));
  });

  return NextResponse.json({
    capabilities: rows,
    // Stated plainly so a client cannot mistake silence for a negative.
    note: "capability 'unknown' means FurlPay has no record for that place — it is not a statement that the property refuses USDC.",
  });
}
