import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { registerResource } from "@/lib/x402Registry";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const RegisterSchema = z.object({
  resource: z.string().min(1).max(2048),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  priceUsd: z.number().positive().max(10), // x402 micropayment cap
  description: z.string().min(1).max(500),
  category: z.enum(["travel", "market-data", "compliance", "custom"]).optional(),
});

// Registration outcome → HTTP status. Duplicate is a conflict; manipulative
// metadata is a bad request; the Sybil cap is back-pressure (429).
const ERROR_STATUS: Record<string, number> = {
  resource_already_registered: 409,
  description_control_characters: 400,
  description_manipulative_content: 400,
  host_registration_limit: 429,
};

// POST /api/x402/register — onboard a resource as x402-payable. Any server
// pointing its middleware at this facilitator registers here; the $10 cap
// keeps registrations inside micropayment territory. Discovery-layer abuse
// (Attack IV) is contained by per-IP rate limiting here plus metadata
// validation and per-host Sybil caps in the registry.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "x402.register", { limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = parse(RegisterSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  const result = registerResource(parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ERROR_STATUS[result.error] ?? 400 });
  }
  return NextResponse.json({ resource: result.resource }, { status: 201 });
}
