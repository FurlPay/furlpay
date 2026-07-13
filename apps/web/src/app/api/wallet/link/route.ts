import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { linkingEnabled } from "@/lib/walletLink";

// GET /api/wallet/link — current link status for the acting user. Read-only,
// exposes only the public linked address + metadata (never secrets, never the
// deprecated safeAddress presented as a real wallet).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!linkingEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const l = auth.account.user.linkedWallet;
  return NextResponse.json({
    linked: l
      ? { address: l.address, chainFamily: l.chainFamily, verificationMethod: l.verificationMethod, verifiedAt: l.verifiedAt, status: l.status }
      : null,
  });
}
