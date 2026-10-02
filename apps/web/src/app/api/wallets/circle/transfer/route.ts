import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { audit } from "@/lib/audit";
import { checkTransferAmount } from "@/lib/kycTiers";
import { screenAddressRisk } from "@/lib/compliance/addressScreening";
import {
  CircleApiError,
  CircleWalletsNotConfigured,
  circleWalletsConfigured,
  createTransferChallenge,
  createUserSession,
  listUserWallets,
  screeningChainFor,
  walletBalances,
} from "@/lib/services/circleWallets";

export const dynamic = "force-dynamic";

// POST /api/wallets/circle/transfer — create a Circle TRANSFER CHALLENGE from
// one of the signed-in user's Circle wallets.
//
// FurlPay moves nothing here. Circle executes the transfer only after the user
// approves the returned challenge with their PIN/biometric in Circle's SDK; the
// key shares are Circle's and the user's. What FurlPay owns is the policy in
// front of that challenge, the same gates /api/wallets/transfer applies:
//   • the wallet must be one Circle lists under THIS user's token;
//   • USDC only — `amount` is then USD, so the KYC tier cap is denominated
//     correctly (other tokens would need a price, and none is invented here);
//   • the amount must not exceed the wallet's Circle-reported balance;
//   • OFAC + Circle Compliance screening on BOTH parties; "review" refuses
//     (409) because there is no review queue;
//   • the client's idempotencyKey goes to Circle, so a retry returns the same
//     challenge rather than a second one.

const DECIMAL = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?$/; // ≤ 999,999,999.999999 USDC

const TransferChallengeSchema = z.object({
  idempotencyKey: z.string().uuid(),
  walletId: z.string().uuid(),
  destinationAddress: z.string().min(26).max(64),
  amount: z
    .string()
    .regex(DECIMAL, "amount must be a decimal string with at most 6 decimals")
    .refine((a): boolean => Number(a) > 0 && Number(a) <= 1_000_000, "amount must be > 0 and ≤ 1,000,000"),
});

function validDestination(address: string, blockchain: string): boolean {
  if (blockchain.startsWith("SOL")) {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;
  const limited = await rateLimitOr429(req, "wallets.circle.transfer", { limit: 10, windowMs: 600_000 }, user.id);
  if (limited) return limited;
  if (!circleWalletsConfigured()) {
    return NextResponse.json({ error: "not_available", detail: "Circle wallets are not configured on this deployment." }, { status: 503 });
  }

  const body = await validateBody(req, TransferChallengeSchema);
  if (body instanceof NextResponse) return body;
  const { idempotencyKey, walletId, destinationAddress, amount } = body;
  const amountUsd = Number(amount);

  const tier = checkTransferAmount(user.kycTier, amountUsd);
  if (!tier.allowed) {
    audit("transfer.blocked", user.id, { rail: "circle", destination: destinationAddress, amount, reason: tier.code });
    return NextResponse.json({ error: tier.reason, code: tier.code, kycTier: user.kycTier }, { status: 403 });
  }

  try {
    const session = await createUserSession(user.id);
    const wallet = (await listUserWallets(session.userToken)).find((w) => w.id === walletId);
    if (!wallet) return NextResponse.json({ error: "wallet_not_found" }, { status: 404 });
    if (wallet.state !== "LIVE") return NextResponse.json({ error: "wallet_not_live", state: wallet.state }, { status: 409 });

    if (!validDestination(destinationAddress, wallet.blockchain)) {
      return NextResponse.json({ error: `Invalid destination address for ${wallet.blockchain}` }, { status: 400 });
    }
    if (destinationAddress.toLowerCase() === wallet.address.toLowerCase()) {
      return NextResponse.json({ error: "Destination is the source wallet" }, { status: 400 });
    }
    const chain = screeningChainFor(wallet.blockchain);
    if (!chain) return NextResponse.json({ error: `Unsupported blockchain ${wallet.blockchain}` }, { status: 400 });

    // Sanctions are not directional: screen the source wallet as well.
    for (const [role, address] of [["destination", destinationAddress], ["source", wallet.address]] as const) {
      const result = await screenAddressRisk(address, chain);
      if (result.action === "review") {
        audit("transfer.blocked", user.id, { rail: "circle", destination: destinationAddress, amount, reason: "aml_review", party: role });
        return NextResponse.json({ error: "Transfer needs compliance review", code: "aml_review_required" }, { status: 409 });
      }
      if (result.action === "block") {
        audit("transfer.blocked", user.id, { rail: "circle", destination: destinationAddress, amount, reason: "aml_screen", party: role });
        return NextResponse.json({ error: "Transfer blocked by AML policy" }, { status: 403 });
      }
    }

    const usdc = (await walletBalances(session.userToken, wallet.id)).find((b) => b.symbol === "USDC" && b.tokenId);
    if (!usdc?.tokenId) return NextResponse.json({ error: "No USDC balance in this wallet" }, { status: 409 });
    if (Number(usdc.amount) < amountUsd) {
      return NextResponse.json({ error: "Insufficient USDC balance", available: usdc.amount }, { status: 409 });
    }

    const challengeId = await createTransferChallenge(session.userToken, {
      idempotencyKey,
      walletId: wallet.id,
      tokenId: usdc.tokenId,
      destinationAddress,
      amount,
    });
    audit("circle.transfer_challenge_created", user.id, {
      walletId: wallet.id,
      blockchain: wallet.blockchain,
      destination: destinationAddress,
      amount,
      challengeId,
    });
    return NextResponse.json(
      { challengeId, ...session, status: "challenge_pending" },
      { status: 201, headers: { "cache-control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof CircleWalletsNotConfigured) return NextResponse.json({ error: "not_available" }, { status: 503 });
    if (e instanceof CircleApiError) {
      console.error(`[wallets/circle/transfer] Circle ${e.status} code=${e.code}:`, e.message);
      return NextResponse.json({ error: "wallet_provider_error", providerCode: e.code }, { status: e.status === 429 ? 429 : 502 });
    }
    console.error("[wallets/circle/transfer] failed:", (e as Error).message);
    return NextResponse.json({ error: "wallet_provider_error" }, { status: 502 });
  }
}
