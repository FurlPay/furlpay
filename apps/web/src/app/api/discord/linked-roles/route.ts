import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";

// GET /api/discord/linked-roles — Linked Roles verification entry point.
// Discord sends users here from a role's Links settings. Full role-connection
// OAuth (verified Furlpay account / developer / contributor metadata) lands
// later; until then, route members to the developer portal.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "discord.linked.roles", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  return NextResponse.redirect("https://furlpay.com/developer", 302);
}
