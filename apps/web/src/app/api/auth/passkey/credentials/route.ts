import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCredentials, removeCredential } from "@/lib/webauthn";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Passkey Wallet Manager backend (extension Settings tab + /profile#security).
// Exposes display metadata only — never the public key or signature counter.

async function requireSession(req: NextRequest) {
  const claims = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!claims?.sub) return null;
  return claims;
}

// GET /api/auth/passkey/credentials — list the caller's registered passkeys.
export async function GET(req: NextRequest) {
  const claims = await requireSession(req);
  if (!claims) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const credentials = getCredentials(claims.sub!).map((c) => ({
    id: c.id,
    name: c.name ?? "Passkey",
    createdAt: c.createdAt ?? null,
    lastUsedAt: c.lastUsedAt ?? null,
    transports: c.transports ?? [],
  }));

  return NextResponse.json({
    credentials,
    // The smart account the credentials control — deterministic per user.
    safeAddress: db.user.safeAddress,
  });
}

// DELETE /api/auth/passkey/credentials — revoke a passkey by credential id.
// body: { credentialId: string }
export async function DELETE(req: NextRequest) {
  const claims = await requireSession(req);
  if (!claims) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { credentialId } = await req.json().catch(() => ({}) as { credentialId?: string });
  if (typeof credentialId !== "string" || !credentialId) {
    return NextResponse.json({ error: "credentialId required" }, { status: 400 });
  }

  // Never allow removing the last passkey — it would lock the account.
  const existing = getCredentials(claims.sub!);
  if (existing.length <= 1 && existing.some((c) => c.id === credentialId)) {
    return NextResponse.json(
      { error: "Cannot remove your only passkey. Add another device first." },
      { status: 409 }
    );
  }

  const removed = removeCredential(claims.sub!, credentialId);
  if (!removed) return NextResponse.json({ error: "Unknown credential" }, { status: 404 });
  return NextResponse.json({ removed: true });
}
