import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { getCredentials, removeCredential } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

// Passkey Wallet Manager backend (extension Settings tab, /profile#security,
// and the native app's passkey screen). Exposes display metadata only — never
// the public key or signature counter. requireUser accepts both the session
// cookie and the native app's Authorization: Bearer token.

// GET /api/auth/passkey/credentials — list the caller's registered passkeys.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;

  const credentials = (await getCredentials(user.id)).map((c) => ({
    id: c.id,
    name: c.name ?? "Passkey",
    createdAt: c.createdAt ?? null,
    lastUsedAt: c.lastUsedAt ?? null,
    transports: c.transports ?? [],
  }));

  return NextResponse.json({
    credentials,
    // The smart account the credentials control — deterministic per user.
    safeAddress: user.safeAddress,
  });
}

// DELETE /api/auth/passkey/credentials — revoke a passkey by credential id.
// body: { credentialId: string }
export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;

  const { credentialId } = await req.json().catch(() => ({}) as { credentialId?: string });
  if (typeof credentialId !== "string" || !credentialId) {
    return NextResponse.json({ error: "credentialId required" }, { status: 400 });
  }

  // Never allow removing the last passkey — it would lock the account.
  const existing = await getCredentials(user.id);
  if (existing.length <= 1 && existing.some((c) => c.id === credentialId)) {
    return NextResponse.json(
      { error: "Cannot remove your only passkey. Add another device first." },
      { status: 409 }
    );
  }

  const removed = await removeCredential(user.id, credentialId);
  if (!removed) return NextResponse.json({ error: "Unknown credential" }, { status: 404 });
  return NextResponse.json({ removed: true });
}
