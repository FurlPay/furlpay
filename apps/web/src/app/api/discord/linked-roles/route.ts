import { NextResponse } from "next/server";

// GET /api/discord/linked-roles — Linked Roles verification entry point.
// Discord sends users here from a role's Links settings. Full role-connection
// OAuth (verified Furlpay account / developer / contributor metadata) lands
// later; until then, route members to the developer portal.
export function GET() {
  return NextResponse.redirect("https://furlpay.com/developer", 302);
}
