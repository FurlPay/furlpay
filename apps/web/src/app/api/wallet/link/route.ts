import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { linkingEnabled } from "@/lib/walletLink";
import { loadLinkedWallet } from "@/lib/linkedWalletStore";

// GET /api/wallet/link — current link status for the acting user. Read-only,
// exposes only the public linked address + metadata (never secrets, never the
// deprecated safeAddress presented as a real wallet).
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!linkingEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  // Hydrate from the durable table so a cold instance still reports the link.
  const l = await loadLinkedWallet(auth.account.user.id);
  return NextResponse.json({
    linked: l
      ? { address: l.address, chainFamily: l.chainFamily, verificationMethod: l.verificationMethod, verifiedAt: l.verifiedAt, status: l.status }
      : null,
  });
}
