import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { readFurlMintState, readFurlConcentration } from "@/lib/token/furlChain";
import {
  FURL_MINT,
  FURL_SYMBOL,
  FURL_NAME,
  FURL_DECIMALS,
  FURL_TOTAL_SUPPLY,
  FURL_TOKEN_PROGRAM,
  FURL_METADATA_URI,
  FURL_IMAGE_URI,
  FURL_EXPLORER,
  FURL_EXPLORER_SOLANA,
  FURL_ALLOCATIONS,
  FURL_LAUNCHED_AT,
  furlAllocationAmount,
} from "@/lib/token/furl";
import { furlPaymentsEnabled } from "@/lib/actions/solana";

export const dynamic = "force-dynamic";

// GET /api/token/furl — FURL's identity, published allocation model, and LIVE
// on-chain state (supply, decimals, authorities, concentration).
//
// Public and unauthenticated on purpose: every field here is already public
// chain data or published tokenomics, and making people sign in to verify a
// token's supply would defeat the point of publishing it. Rate-limited so the
// route cannot be used as a free RPC proxy, and the mint is a constant — no
// query parameter can redirect this read at a different token.
//
// `chain.ok: false` is a first-class outcome. The caller renders "unavailable";
// it must not fall back to the static numbers, because the static numbers are
// what the live read exists to check.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "token.furl", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const [mintState, concentration] = await Promise.all([
    readFurlMintState(),
    readFurlConcentration(),
  ]);

  return NextResponse.json({
    token: {
      mint: FURL_MINT,
      symbol: FURL_SYMBOL,
      name: FURL_NAME,
      decimals: FURL_DECIMALS,
      standard: "Token-2022",
      tokenProgram: FURL_TOKEN_PROGRAM,
      chain: "solana",
      network: "mainnet-beta",
      launchedAt: FURL_LAUNCHED_AT,
      totalSupply: FURL_TOTAL_SUPPLY,
      metadataUri: FURL_METADATA_URI,
      imageUri: FURL_IMAGE_URI,
      explorers: { solscan: FURL_EXPLORER, solanaExplorer: FURL_EXPLORER_SOLANA },
    },
    allocations: FURL_ALLOCATIONS.map((a) => ({
      ...a,
      furl: furlAllocationAmount(a.percent),
    })),
    // The honest disclosures, served alongside the numbers so any consumer of
    // this API (including a third-party aggregator) gets them with the data.
    disclosures: {
      peg: "none",
      reserves: "none",
      redemption: "none",
      note:
        "FURL is a fixed-supply Token-2022 payment token. It implements no USD peg, " +
        "no reserve backing, and no redemption mechanism. It is not a claim on FurlPay " +
        "or on any asset.",
    },
    state: {
      /** Whether FURL checkout is live on this deployment (needs a real price). */
      paymentsEnabled: furlPaymentsEnabled(),
      liquidityPool: null,
    },
    chain: mintState.ok
      ? { ok: true as const, ...mintState.data }
      : { ok: false as const, error: mintState.error, detail: mintState.detail },
    concentration: concentration.ok
      ? { ok: true as const, ...concentration.data }
      : { ok: false as const, error: concentration.error, detail: concentration.detail },
  });
}
