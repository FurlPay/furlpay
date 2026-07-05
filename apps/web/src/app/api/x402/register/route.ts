import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { registerResource } from "@/lib/x402Registry";

export const dynamic = "force-dynamic";

const RegisterSchema = z.object({
  resource: z.string().min(1).max(2048),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]),
  priceUsd: z.number().positive().max(10), // x402 micropayment cap
  description: z.string().min(1).max(500),
  category: z.enum(["travel", "market-data", "compliance", "custom"]).optional(),
});

// POST /api/x402/register — onboard a resource as x402-payable. Any server
// pointing its middleware at this facilitator registers here; the $10 cap
// keeps registrations inside micropayment territory.
export async function POST(req: NextRequest) {
  const parsed = parse(RegisterSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;

  const result = registerResource(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ resource: result.resource }, { status: 201 });
}
