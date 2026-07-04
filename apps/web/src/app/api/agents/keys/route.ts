import { NextRequest, NextResponse } from "next/server";
import { listAgentKeyIds, registerAgentKey } from "@/lib/agentTrustGate";

export const dynamic = "force-dynamic";

// POST /api/agents/keys — register an agent's Ed25519 public key (SPKI PEM).
// The returned keyId is what the agent puts in its RFC 9421 keyid parameter
// when signing requests to gated routes like /api/escrow.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const publicKeyPem = (body as { publicKeyPem?: string }).publicKeyPem;
  if (!publicKeyPem?.includes("BEGIN PUBLIC KEY")) {
    return NextResponse.json({ error: "publicKeyPem (SPKI PEM) required" }, { status: 400 });
  }
  try {
    return NextResponse.json({ keyId: registerAgentKey(publicKeyPem) });
  } catch {
    return NextResponse.json({ error: "invalid public key" }, { status: 400 });
  }
}

// GET /api/agents/keys — list registered agent key ids.
export function GET() {
  return NextResponse.json({ keyIds: listAgentKeyIds() });
}
