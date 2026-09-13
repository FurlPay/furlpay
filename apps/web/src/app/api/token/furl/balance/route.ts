import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { optionalUser } from "@/lib/authz";
import { readFurlBalance } from "@/lib/token/furlBalance";

export const dynamic = "force-dynamic";

// GET /api/token/furl/balance — FURL balance for one Solana address.
//
// TWO WAYS TO ASK, one read:
//   ?owner=<base58>   any address; public chain data, rate-limited
//   (no params)       the signed-in user's linked wallet, IF it is a Solana one
//
// Signing in is not required for the `owner` form: a token balance is public on
// Solana and anyone can read it with a public RPC, so gating it would add
// friction without adding privacy. What IS enforced: the MINT is fixed in code,
// so this route can never be pointed at an arbitrary token, and the rate limit
// keeps it from becoming an open RPC proxy on our key.
//
// An unreadable chain returns 503, not a zero balance. "You hold no FURL" and
// "we could not check" are different statements about someone's money.
export async function GET(req: NextRequest) {
  const limited = await rateLimitOr429(req, "token.furl.balance", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  let owner = req.nextUrl.searchParams.get("owner")?.trim() || "";
  let source: "query" | "linked_wallet" = "query";

  if (!owner) {
    const auth = await optionalUser(req);
    // A credential that was offered and is dead (revoked/expired/locked) is
    // rejected, never silently treated as a guest asking about no address.
    if (auth.kind === "rejected") return auth.res;
    const linked = auth.kind === "user" ? auth.account.user.linkedWallet ?? null : null;
    if (!linked) {
      return NextResponse.json(
        {
          error: "no_owner",
          detail:
            "Pass ?owner=<solana address>, or sign in with a linked Solana wallet to read your own balance.",
        },
        { status: 400 },
      );
    }
    // Account wallet-linking currently verifies EVM addresses only (EIP-191
    // signature, `chainFamily: "evm"`). FURL lives on Solana, so an EVM link
    // cannot answer this question — and deriving "a Solana address" from it
    // would be a fabricated answer about someone's holdings.
    // `chainFamily` is typed as the literal "evm" today, so this is widened
    // rather than compared directly — the check must survive the day a Solana
    // link is added to the type, instead of silently becoming dead code.
    if ((linked.chainFamily as string) !== "solana") {
      return NextResponse.json(
        {
          error: "wrong_chain_family",
          detail: `Your linked wallet is ${linked.chainFamily.toUpperCase()}; FURL is a Solana token. Pass ?owner=<solana address>.`,
        },
        { status: 400 },
      );
    }
    owner = linked.address;
    source = "linked_wallet";
  }

  // AGENTS.md rule 9: externally-supplied Solana addresses are validated with
  // `new PublicKey()`, not a regex. Base58 of the right LENGTH is not the same
  // as 32 decodable bytes, and the lenient check would hand a bad address to
  // the RPC.
  try {
    new PublicKey(owner);
  } catch {
    return NextResponse.json(
      { error: "invalid_address", detail: "Not a valid Solana (base58) address" },
      { status: 400 },
    );
  }

  const balance = await readFurlBalance(owner);
  if (!balance.ok) {
    // 400 for a caller mistake, 503 for our inability to read the chain — a
    // client retrying on 503 is correct, retrying on 400 never is.
    const status = balance.error === "invalid_address" ? 400 : 503;
    return NextResponse.json({ error: balance.error, detail: balance.detail, source }, { status });
  }

  return NextResponse.json({ ...balance, source });
}
