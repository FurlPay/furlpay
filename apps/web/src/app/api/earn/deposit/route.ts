import { NextRequest, NextResponse } from "next/server";
import { newTx, recordTransaction } from "@/lib/store";
import { selectVault, buildDepositBundle, earnIsLive } from "@/lib/services/morpho";
import { addToPosition } from "@/lib/services/earn";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";

export const dynamic = "force-dynamic";

// POST /api/earn/deposit — deposit idle USDC into a Morpho vault.
// Body: { amountUsd: number, vault?: address }.
//
// Non-custodial: in LIVE mode we return the unsigned ERC-4626 tx bundle
// (approve USDC + vault.deposit) for the user's Safe to sign — FurlPay never
// moves funds itself. In MOCK/dev mode we simulate the position so the demo UX
// works (debit idle USDC, open/extend the position). Production without a live
// integration refuses (503) rather than crediting a fake position — mirrors the
// account-funding guard.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const limited = await rateLimitOr429(req, "earn.deposit", { limit: 20, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const live = earnIsLive();
  if (process.env.NODE_ENV === "production" && !live) {
    return NextResponse.json({ ok: false, error: "earn_unavailable" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const amountUsd = Number(body?.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return NextResponse.json({ ok: false, error: "invalid_amount" }, { status: 400 });
  }

  // A deposit debits the USDC balance and opens a position, so a retry after a
  // timeout would debit twice. Same contract as wallets/transfer and
  // investing/order: scoped per user so one client's key can never replay
  // another account's deposit, and a request without the header behaves
  // exactly as before.
  const idempotencyKey = req.headers.get("Idempotency-Key");
  return withIdempotency(idempotencyKey, `earn.deposit:${account.user.id}`, async () => {

  const vault = await selectVault(typeof body?.vault === "string" ? body.vault : undefined);

  // LIVE: return the tx bundle for the Safe to sign. The position is recorded
  // when the deposit settles (webhook / on-chain read), not here.
  if (live) {
    const receiver = account.user.safeAddress;
    const bundle = buildDepositBundle(vault.address, amountUsd, receiver);
    return NextResponse.json({
      ok: true,
      mode: "live",
      vault: { address: vault.address, name: vault.name, netApy: vault.netApy },
      amountUsd: round(amountUsd),
      ...bundle,
    });
  }

  // MOCK: simulate. Debit idle USDC and open/extend the position.
  const bal = account.tokenBalances.find((b) => b.token === "USDC");
  if (!bal || bal.usdValue + 1e-9 < amountUsd) {
    return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status: 400 });
  }
  const perUnit = bal.amount > 0 ? bal.usdValue / bal.amount : 1;
  bal.amount = round(bal.amount - amountUsd / perUnit);
  bal.usdValue = round(bal.usdValue - amountUsd);

  const pos = addToPosition({
    vault: vault.address,
    vaultName: vault.name,
    apy: vault.netApy,
    chainId: vault.chainId,
    amountUsd,
    receiver: account.user.safeAddress,
  });

  recordTransaction(
    account.user.id,
    newTx({
      category: "yield",
      direction: "out",
      title: "Deposited into FurlPay Earn",
      subtitle: `${vault.name} · ${vault.netApy}% APY`,
      amountUsd,
      token: "USDC",
      chain: "arbitrum",
      status: "settled",
    }),
  );

  return NextResponse.json({
    ok: true,
    mode: "mock",
    vault: { address: vault.address, name: vault.name, netApy: vault.netApy },
    position: { principalUsd: pos.principalUsd, apy: pos.apy },
    projectedYearly: round((pos.principalUsd * pos.apy) / 100),
  });
  });
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
