import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { requireMobileAttestation } from "@/lib/attestation";
import { validateBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { linkingEnabled, verifyLink } from "@/lib/walletLink";
import { setLinkedWallet, type LinkedWallet } from "@/lib/store";
import { linkWalletDurable } from "@/lib/linkedWalletStore";
import { recentStepUp, consumeStepUp } from "@/lib/stepup";
import { recordSecurityEvent } from "@/lib/ops/events";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

// POST /api/wallet/link/verify — verify the device's EIP-191 signature against
// the server-issued challenge and, on success, persist the linked wallet.
//
// Re-linking policy (Phase 1):
//   - no link yet            -> establish it
//   - SAME address re-linked  -> idempotent success (re-proves control)
//   - DIFFERENT address       -> 409, refuse silent replacement (unlink is a
//                                future explicit recovery flow)
//   - address linked to ANOTHER account -> 409, no cross-account hijack
export const dynamic = "force-dynamic";

const Body = z.object({
  address: z.string().min(42).max(42),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
});

export async function POST(req: NextRequest) {
  if (!linkingEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  // Mobile clients must present a platform attestation over a fresh single-use
  // nonce when FURLPAY_ATTESTATION_MODE=enforce (lib/attestation, P1-9).
  const unattested = await requireMobileAttestation(req, auth.account.user.id, "wallet.link");
  if (unattested) return unattested;
  if (auth.claims.guest) return NextResponse.json({ error: "guest_forbidden" }, { status: 403 });

  const limited = await rateLimitOr429(req, "wallet.link.verify", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const user = auth.account.user;
  const claimed = body.address;

  // Step-up gate: a bare session is NOT enough to permanently bind a wallet.
  // Require a recent strong re-auth (fresh OTP or passkey) bound to THIS
  // session's jti — a different (stolen/concurrent) session has none. Local
  // device biometrics do not count. Checked before the (cheap) signature
  // verify so an unauthorized caller learns nothing.
  if (!(await recentStepUp(user.id, auth.claims.jti))) {
    audit("wallet.link_rejected", user.id, { address: claimed.toLowerCase(), reason: "stepup_required" });
    return NextResponse.json(
      { error: "stepup_required", detail: "Re-verify with a login code or passkey, then try again." },
      { status: 403 }
    );
  }

  const reject = (error: string, status: number) => {
    audit("wallet.link_rejected", user.id, { address: claimed.toLowerCase(), reason: error });
    void recordSecurityEvent({
      rail: "transfers",
      kind: "wallet_link_rejected",
      severity: error === "signer_mismatch" || error === "cross_account" ? "high" : "low",
      detail: `wallet link ${error}`,
      actor: user.id,
    }).catch(() => {});
    return NextResponse.json({ error }, { status });
  };

  // Prove control FIRST (cheap ecrecover) — a caller must sign the challenge
  // before we consult or mutate any durable link state.
  const result = await verifyLink(user.id, claimed, body.signature);
  if (!result.ok) return reject(result.error, result.status);

  // Atomic, DB-enforced uniqueness (migration 0005). Race-safe across
  // instances: the Postgres UNIQUE constraint decides the winner.
  const existing = user.linkedWallet;
  const outcome = await linkWalletDurable(user.id, result.address, result.nonce);
  if (outcome === "conflict_address") return reject("cross_account", 409);
  if (outcome === "conflict_user_has_wallet") return reject("already_linked_different_address", 409);

  // outcome is "linked" or "idempotent" — cache it on the in-memory record.
  const linked: LinkedWallet = {
    address: result.address,
    chainFamily: "evm",
    verificationMethod: "eip191",
    verifiedAt: existing?.verifiedAt ?? new Date().toISOString(),
    linkVersion: 1,
    status: "active",
    proofNonce: result.nonce,
  };
  setLinkedWallet(user.id, linked);

  // Single-use: burn the step-up so it can't authorize a second link in-window.
  void consumeStepUp(user.id, auth.claims.jti);

  audit("wallet.link_established", user.id, { address: result.address, reLink: Boolean(existing) });
  void recordSecurityEvent({
    rail: "transfers",
    kind: "wallet_link_established",
    severity: "info",
    detail: `wallet ${result.address} linked`,
    actor: user.id,
  }).catch(() => {});

  // Notify the account email — a link is a security-relevant event, so the
  // real owner learns of it even if a stolen session established it.
  if (user.email && !existing) {
    void sendEmail({
      to: user.email,
      category: "security",
      subject: "A wallet was linked to your FurlPay account",
      text: `The wallet address ${result.address} was just linked to your FurlPay account. If this wasn't you, lock your account from Settings immediately and contact support.`,
      html: `<p>The wallet address <code>${result.address}</code> was just linked to your FurlPay account.</p><p>If this wasn't you, lock your account from Settings immediately and contact support.</p>`,
    }).catch(() => {});
  }

  return NextResponse.json({ linked: { address: linked.address, verifiedAt: linked.verifiedAt, status: linked.status } });
}
