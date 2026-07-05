import { NextResponse } from "next/server";
import { contractDirectory } from "@/lib/services/chainRegistry";

// GET /api/chain/contracts — the Furlpay smart-contract directory. Addresses
// resolve from env once deployed; undeployed contracts report
// "pending_deployment" so integrators never hardcode stale addresses.
export function GET() {
  return NextResponse.json({ contracts: contractDirectory() });
}
