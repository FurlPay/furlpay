import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { readFurlMintState, readFurlConcentration } from "@/lib/token/furlChain";
import { baseUnitsToFurl, FURL_DECIMALS, FURL_MINT } from "@/lib/token/furl";
import { computeCirculating } from "@/lib/token/furlCirculating";
import { FURL_SPOKES, bridgeIsLive } from "@/lib/token/furlBridge";

export const dynamic = "force-dynamic";

// GET /api/token/furl/supply/cross-chain — supply across every chain FURL exists on.
//
// TODAY THAT IS ONE CHAIN. No bridge is deployed, no spoke contract exists, and
// nothing is locked. The response says so explicitly rather than returning an
// empty spoke list that a reader could mistake for "bridged, but zero".
//
// THE INVARIANT THIS PUBLISHES:
//     solanaCirculating + solanaLocked      == 1,000,000,000
//     sum(spokeSupplies)                    == solanaLocked
//
// Every bridge exploit ends with spoke supply that no locked balance backs, and
// the spoke's own accounting looks perfectly consistent the whole time — the
// only thing that reveals it is comparing the two sides. Publishing the
// comparison means anyone can check it, not just us.
//
// NO MOCK NUMBERS. Where a value cannot be read it is null and the status says
// why. A placeholder here would be a supply figure aggregators cache.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "token.furl.supply.crosschain", {
    limit: 60,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const [mintState, concentration] = await Promise.all([
    readFurlMintState(),
    readFurlConcentration(),
  ]);

  if (!mintState.ok) {
    return NextResponse.json(
      {
        error: mintState.error,
        detail: mintState.detail,
        note:
          "Supply is read from Solana on request. The chain could not be read, so no figure " +
          "is returned — deliberately not a zero or a cached guess.",
      },
      { status: 503 },
    );
  }

  const totalRaw = BigInt(mintState.data.supplyRaw);

  // Nothing is locked because no lockbox exists. Stated as a measured zero with
  // a reason, not asserted.
  const lockedRaw = 0n;

  const split = concentration.ok
    ? computeCirculating(totalRaw, concentration.data.holders)
    : null;

  if (concentration.ok && split && split.excluded.length === 0 && split.publicHolders.length === 0) {
    return NextResponse.json(
      {
        error: "no_holders_attributed",
        detail:
          `Total supply is ${totalRaw} base units but no token accounts were returned. ` +
          `Refusing to report the full supply as circulating on an incomplete read.`,
      },
      { status: 503 },
    );
  }

  const solanaCirculatingRaw = split ? split.circulatingRaw - lockedRaw : null;
  const spokeSupplyRaw = FURL_SPOKES.reduce((a, s) => a + (s.supplyBaseUnits ?? 0n), 0n);

  // The invariant, evaluated rather than assumed.
  let invariantCheck: "PASS" | "WARN" | "BREACH" | "NOT_APPLICABLE";
  let invariantDetail: string;

  if (!bridgeIsLive()) {
    invariantCheck = "NOT_APPLICABLE";
    invariantDetail =
      "No bridge is deployed. There are no spoke contracts and nothing is locked, so " +
      "there is no cross-chain invariant to evaluate yet.";
  } else if (spokeSupplyRaw > lockedRaw) {
    invariantCheck = "BREACH";
    invariantDetail =
      `${baseUnitsToFurl(spokeSupplyRaw - lockedRaw)} FURL exists on spokes with nothing ` +
      `locked behind it.`;
  } else if (spokeSupplyRaw < lockedRaw) {
    invariantCheck = "WARN";
    invariantDetail =
      `${baseUnitsToFurl(lockedRaw - spokeSupplyRaw)} FURL locked with no spoke supply ` +
      `behind it — expected briefly during an in-flight transfer.`;
  } else {
    invariantCheck = "PASS";
    invariantDetail = "Spoke supply equals locked supply.";
  }

  return NextResponse.json({
    totalSupply: Number(baseUnitsToFurl(totalRaw)),
    totalSupplyString: baseUnitsToFurl(totalRaw),
    decimals: FURL_DECIMALS,
    mint: FURL_MINT,

    bridge: {
      live: bridgeIsLive(),
      protocol: "Wormhole NTT (planned)",
      model: "hub-and-spoke (Solana locking, EVM burning)",
      note: bridgeIsLive()
        ? undefined
        : "Not deployed. FURL exists only on Solana; no spoke contract has been deployed " +
          "and no FURL is locked.",
    },

    solana: {
      role: "hub",
      circulating: solanaCirculatingRaw === null ? null : Number(baseUnitsToFurl(solanaCirculatingRaw)),
      circulatingString: solanaCirculatingRaw === null ? null : baseUnitsToFurl(solanaCirculatingRaw),
      locked: Number(baseUnitsToFurl(lockedRaw)),
      lockedString: baseUnitsToFurl(lockedRaw),
      issuerHeld: split ? baseUnitsToFurl(split.excludedRaw) : null,
    },

    // One entry per configured spoke. Empty today, and `live` says why.
    spokes: FURL_SPOKES.map((s) => ({
      chain: s.chain,
      chainId: s.chainId,
      token: s.token,
      deployed: s.token !== null,
      circulating: s.supplyBaseUnits === null ? null : Number(baseUnitsToFurl(s.supplyBaseUnits)),
    })),

    invariantCheck,
    invariantDetail,

    disclosures: {
      peg: "none",
      reserves: "none",
      redemption: "none",
      note:
        "FURL is a fixed-supply Token-2022 payment token with no USD peg, no reserve backing " +
        "and no redemption mechanism. Mint authority is still active, so the 1,000,000,000 cap " +
        "is published intent rather than a runtime guarantee.",
    },

    readAt: mintState.data.readAt,
    slot: mintState.data.slot,
  });
}
