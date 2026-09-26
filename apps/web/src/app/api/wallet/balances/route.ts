import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { loadLinkedWallet } from "@/lib/linkedWalletStore";
import { selfCustodyStage } from "@/lib/walletLink";
import {
  onChainReadsEnabled,
  readUsdcBalances,
  formatUsdc,
  type UsdcChain,
} from "@/lib/services/usdcBalances";

// ---------------------------------------------------------------------------
// GET /api/wallet/balances — Phase 2. Live on-chain USDC for the LINKED
// self-custodial address (docs/BALANCE-CUSTODY-MAP.md).
//
// Deliberately a SEPARATE route from /api/overview and /api/wallets.
//
// Those return the internal ledger, which is a different kind of number with a
// different custody type behind it. Returning both from one endpoint would
// invite exactly the sum this architecture forbids — a caller adding an
// on-chain balance to a ledger balance and rendering one "total" that nobody
// can spend. A client that wants both asks for both and labels them.
//
// Every row carries `asOf.source`: "chain" (live read, with the block/slot it
// reflects) or "cache" (the live read failed and this is a stale fallback).
// The client MUST surface that distinction — an unlabelled cached number is
// indistinguishable from live truth, which is the whole failure this design
// exists to prevent.
//
// Read-only. No money moves here, so there is nothing to make idempotent.
// Authenticated, so the middleware baseline rate limit applies; no tighter
// per-route budget is added because a balance refresh is a normal, frequent
// action and the upstream RPC calls are already time-budgeted.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

/** Chains this route can read, bounded by what Phase 1 linking can PROVE. */
const SUPPORTED: readonly UsdcChain[] = ["base", "arbitrum"];

export async function GET(req: NextRequest) {
  // 404 rather than 403: below stage 2 this capability does not exist on this
  // deployment, and saying "forbidden" would imply it might work with
  // different credentials.
  if (!onChainReadsEnabled()) {
    return NextResponse.json(
      { error: "not_enabled", detail: "On-chain balance reads are not enabled on this deployment." },
      { status: 404 },
    );
  }

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const linked = await loadLinkedWallet(auth.account.user.id);
  if (!linked || linked.status !== "active") {
    // Not an error — the honest answer is "you have not linked a device yet".
    // Returning an empty balance list instead would read as "you have nothing",
    // which is a claim about someone's money we are not entitled to make.
    return NextResponse.json(
      {
        linked: null,
        balances: [],
        detail: "No verified device wallet is linked to this account.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  // EVM ONLY, because that is all Phase 1 linking can prove.
  //
  // `LinkedWallet.chainFamily` is the literal "evm" and `verificationMethod`
  // is "eip191" — there is no Solana linking path yet (proving an ed25519 key
  // needs its own challenge format and its own server-side recovery). The
  // reader in usdcBalances.ts supports Solana and is tested for it; this route
  // does not offer it, because offering a chain we cannot prove ownership of
  // would mean reading a balance for an address the user merely claims.
  const balances = await readUsdcBalances({
    evmAddress: linked.address,
    chains: ["base", "arbitrum"] as const,
    // No cache is passed: this deployment has no reconciled on-chain cache for
    // the linked address yet (that is Phase 4's reconciliation job). Passing
    // the ledger balance here would be worse than passing nothing — it is a
    // number for a DIFFERENT custody type, and labelling it "cache" would
    // assert it was once an on-chain read of this address. It never was.
  });

  return NextResponse.json(
    {
      linked: { address: linked.address, chainFamily: linked.chainFamily },
      stage: selfCustodyStage(),
      supported: SUPPORTED,
      balances: balances.map((b) => ({
        ...b,
        // Atomic units stay authoritative; `display` is a convenience string
        // built by exact string slicing, never Number(atomic)/1e6.
        display: formatUsdc(b.atomic, b.decimals),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
