import { NextRequest, NextResponse } from "next/server";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { readFurlMintState, readFurlConcentration } from "@/lib/token/furlChain";
import { FURL_DECIMALS, baseUnitsToFurl } from "@/lib/token/furl";
import { computeCirculating, ISSUER_OWNERS } from "@/lib/token/furlCirculating";

export const dynamic = "force-dynamic";

// GET /api/token/furl/supply — total and circulating supply, for aggregators.
//
// FORMAT follows CoinGecko's endpoint requirement: HTTPS, publicly accessible
// with no authentication, JSON, plain numeric values with decimals included,
// and a rate limit generous enough for polling every 30 minutes.
//   https://support.coingecko.com/hc/en-us/articles/29203078866457
//
// `?q=circulating` and `?q=total` return a BARE NUMBER as text/plain, which is
// the shape CoinMarketCap's supply endpoints expect. One route, both contracts.
//
// ── HOW CIRCULATING SUPPLY IS COMPUTED, AND WHY IT IS 0 ────────────────────
// Circulating supply excludes tokens the issuer still controls. Today 100% of
// FURL sits in the deployer's own token account, so the honest circulating
// figure is ZERO — there is no float, no public holder, no market.
//
// It would be trivial to report 1,000,000,000 here and let an aggregator
// multiply it by a price to print a large market cap. That is the single most
// common way token supply data is falsified, and it is why CoinGecko's own
// methodology excludes team, treasury and unreleased tokens. This endpoint
// computes the exclusion from the CHAIN — it reads the deployer's balance and
// subtracts it — rather than from a number we typed.
//
// When the treasury migrates to multisigs, those addresses join EXCLUDED below
// and circulating supply continues to reflect reality without anyone editing a
// constant.
// ---------------------------------------------------------------------------


export async function GET(req: NextRequest) {
  // 60/min is far above the once-per-30-minutes aggregators need, and low
  // enough that this cannot be used to hammer our RPC.
  const limited = await rateLimitOr429(req, "token.furl.supply", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const [mintState, concentration] = await Promise.all([
    readFurlMintState(),
    readFurlConcentration(),
  ]);

  const q = req.nextUrl.searchParams.get("q")?.toLowerCase();

  // An unreadable chain must NOT become a confident supply number. Aggregators
  // cache what we return, so a fabricated figure outlives the outage.
  if (!mintState.ok) {
    if (q === "circulating" || q === "total") {
      return new NextResponse("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
    }
    return NextResponse.json(
      {
        error: mintState.error,
        detail: mintState.detail,
        note: "Supply is read from Solana on request. The chain could not be read, so no figure is returned — this is deliberately not a zero or a cached guess.",
      },
      { status: 503 },
    );
  }

  const totalRaw = BigInt(mintState.data.supplyRaw);

  // Attribute holders by IDENTITY, not by shape. Each issuer owner is resolved
  // to its Token-2022 associated token account and matched on that address, so
  // the arithmetic keeps working after the treasury migrates to six multisigs.
  // (The previous heuristic — "exclude the holder at 100%" — would have excluded
  // NOTHING once six holders existed, reporting the whole supply as circulating
  // on the day custody improved.)
  const split = concentration.ok
    ? computeCirculating(totalRaw, concentration.data.holders)
    : null;

  // Fail loudly on an incoherent split rather than publishing a clamped number.
  if (split && split.excludedRaw > totalRaw) {
    return NextResponse.json(
      {
        error: "supply_mismatch",
        detail:
          `Excluded balances (${split.excludedRaw}) exceed total supply (${totalRaw}). ` +
          `Refusing to publish a supply figure derived from inconsistent reads.`,
      },
      { status: 503 },
    );
  }
  if (split?.unresolvedIssuer) {
    return NextResponse.json(
      {
        error: "issuer_unresolved",
        detail:
          "An issuer-controlled owner could not be resolved to a token account, so the " +
          "exclusion set is incomplete. Refusing to overstate circulating supply.",
      },
      { status: 503 },
    );
  }

  // A supply that exists but has NO attributed holders is incoherent, and it is
  // the most dangerous shape this endpoint can be handed: with nothing to
  // exclude, the arithmetic reports the ENTIRE supply as circulating. A flaky
  // RPC returning `ok` with an empty account list would therefore publish
  // "1,000,000,000 circulating" — precisely the fabricated market cap this route
  // exists to prevent, and aggregators would cache it.
  //
  // Tokens must be somewhere. If supply is non-zero and no holder came back,
  // the read is wrong, not the chain.
  if (split && totalRaw > 0n && split.excluded.length === 0 && split.publicHolders.length === 0) {
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

  const excludedRaw = split?.excludedRaw ?? 0n;
  const excludedDetail = split?.excluded ?? [];
  const circulatingRaw = split?.circulatingRaw ?? 0n;

  const total = baseUnitsToFurl(totalRaw);
  const circulating = baseUnitsToFurl(circulatingRaw);

  // Bare-number responses for CMC-style consumers.
  if (q === "total") {
    return new NextResponse(total, { headers: { "content-type": "text/plain" } });
  }
  if (q === "circulating") {
    // Only served when the exclusion was actually computed from a chain read.
    if (!concentration.ok) {
      return new NextResponse("unavailable", { status: 503, headers: { "content-type": "text/plain" } });
    }
    return new NextResponse(circulating, { headers: { "content-type": "text/plain" } });
  }

  return NextResponse.json({
    // Numeric fields, decimals included, as the CoinGecko requirement asks.
    total_supply: Number(total),
    circulating_supply: concentration.ok ? Number(circulating) : null,
    max_supply: Number(total),
    decimals: FURL_DECIMALS,

    // Strings alongside, because a supply this size is exact only as a string.
    total_supply_string: total,
    circulating_supply_string: concentration.ok ? circulating : null,
    total_supply_raw: totalRaw.toString(),

    mint: mintState.data.mint,
    chain: "solana",
    token_standard: "Token-2022",

    circulating_supply_methodology:
      "Total supply minus issuer-controlled holdings, computed from on-chain balances at request time. " +
      "Issuer owners are resolved to their Token-2022 associated token accounts and matched by address. " +
      "Treasury, team, unvested and undistributed allocations are excluded because they are not in public float.",
    issuer_controlled_owners: ISSUER_OWNERS.map((o) => ({ owner: o.owner, label: o.label })),
    public_holders: split?.publicHolders ?? null,
    excluded_from_circulating: concentration.ok ? excludedDetail : null,

    // The facts an aggregator should carry with the numbers.
    mint_authority: mintState.data.mintAuthority,
    mint_authority_active: mintState.data.mintAuthority !== null,
    freeze_authority: mintState.data.freezeAuthority,
    disclosures: {
      peg: "none",
      reserves: "none",
      redemption: "none",
      note:
        "FURL is a fixed-supply Token-2022 payment token with no USD peg, no reserve backing and no " +
        "redemption mechanism. The mint authority is still active, so the 1,000,000,000 cap is " +
        "published intent rather than a runtime guarantee.",
    },

    read_at: mintState.data.readAt,
    slot: mintState.data.slot,
  });
}
