import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The signing-path ratchet.
//
// ── WHAT THE AUDIT FOUND ───────────────────────────────────────────────────
//
// This application has NO transaction-signing path. Not one call to
// `eth_sendTransaction` or `eth_signTransaction` exists. That is deliberate:
// DepositFlow shows a destination address instead of building a transfer, and
// swap calldata is returned by the API for integrators rather than broadcast.
//
// That absence is the reason the wallet layer currently cannot lose money, and
// it is why `assertChain()` is deliberately unwired — there is nothing to wire
// it into.
//
// The risk is that this changes quietly. The day someone adds a send path,
// several findings that are theoretical today become live P0s: a stale cached
// chainId means a Base transaction submitted on Ethereum, where identical
// calldata reaches a different contract.
//
// ── WHAT THIS TEST CAN AND CANNOT DO ───────────────────────────────────────
//
// It CAN detect that a signing method appeared. That is a literal string in
// source and is reliable to find.
//
// It CANNOT verify that `assertChain()` is called on the right object, at the
// right moment, before the right request. Proving "this runs immediately
// before that" needs dataflow analysis, and a regex pretending to do it would
// be a fake security check — worse than none, because it would pass while
// being wrong.
//
// So the ratchet is honest about its scope: it FAILS when a signing method
// appears in a file that does not also reference chain verification, and its
// failure message tells the author what a reviewer must confirm by reading the
// code. It is a review trigger, not a proof.
// ---------------------------------------------------------------------------

const SRC = join(__dirname, "..", "..", "..");

/**
 * Methods where FURLPAY (or the user, through our UI) PRODUCES a signature or
 * hands an unsigned transaction to a wallet to sign and send.
 *
 * These are the ones that need live chain verification immediately before the
 * call: the chain is an input to what gets signed, and a stale chainId means
 * signing for the wrong network.
 */
const SIGNING_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
] as const;

/**
 * Methods that RELAY data somebody else already signed.
 *
 * Deliberately NOT in SIGNING_METHODS. `eth_sendRawTransaction` takes a signed
 * blob: the chain id is already inside it and was fixed at signing time, by
 * whoever signed. Demanding assertChain() here would be theatre — we would be
 * "verifying" a chain we have no ability to change, on a transaction we did
 * not construct.
 *
 * The real risk with a relay is different and is pinned separately below: not
 * "is the chain right" but "can this be reached at all".
 */
const RELAY_METHODS = ["eth_sendRawTransaction"] as const;

/** Files allowed to NAME a signing method without calling it. */
const PROSE_ALLOWED = new Set([
  // Documents the boundary — the comments are the point.
  "lib/wallet/connect.ts",
  "lib/wallet/__tests__/signingPathRatchet.spec.ts",
  // Explains why it shows an address instead of building a transfer.
  "components/wallet/DepositFlow.tsx",
  // The RPC allowlist documents which methods it refuses to proxy.
  "app/api/chain/rpc/route.ts",
  // Chain adapters implement broadcastTransaction(signedTx), which RELAYS an
  // already-signed transaction — it never produces a signature, so it is not a
  // wallet-signing path. It is also unreferenced by application code, which is
  // the property the separate test below pins.
  "lib/chains/evmAdapter.ts",
  "lib/chains/solanaAdapter.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

/** Source with // and /* *\/ comments removed, so prose does not trip the scan. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      // Crude but sufficient: strip from // unless it is inside a string that
      // obviously contains a URL. Signing methods never appear in URLs.
      const idx = line.indexOf("//");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

const files = walk(SRC).map((f) => ({
  path: f.slice(SRC.length + 1).replace(/\\/g, "/"),
  code: code(readFileSync(f, "utf8")),
}));

describe("signing-path ratchet", () => {
  it("scans a non-trivial number of files", () => {
    // Guards the guard — a wrong root makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(300);
  });

  it("has no transaction-signing path outside the documented boundary", () => {
    const offenders = files
      .filter((f) => !PROSE_ALLOWED.has(f.path))
      .filter((f) => SIGNING_METHODS.some((m) => f.code.includes(m)))
      // A file that signs MUST also reference live chain verification.
      .filter((f) => !/assertChain/.test(f.code))
      .map((f) => f.path);

    expect(
      offenders,
      "A transaction-signing method appeared in a file that does not reference " +
        "assertChain(). Before allowlisting it, a reviewer must confirm BY READING " +
        "THE CODE that a live eth_chainId check runs immediately before the send — " +
        "this test cannot prove ordering, only that the check is absent entirely.\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("still finds the method names it is looking for", () => {
    // If a rename made these unmatchable, the test above would pass forever
    // while checking nothing. At least one file must mention one, proving the
    // scan works.
    const all = [...SIGNING_METHODS, ...RELAY_METHODS];
    const seen = files.some((f) =>
      all.some((m) => readFileSync(join(SRC, f.path), "utf8").includes(m)),
    );
    expect(seen).toBe(true);
  });

  it("keeps relay methods to the two reviewed locations", () => {
    // A relay does not need assertChain (see RELAY_METHODS), but it must not
    // spread. The two places allowed to relay a signed blob, and why:
    //
    //   lib/chains/*       the adapter layer. Orphaned — see the test below.
    //   app/api/chain/rpc  a NON-CUSTODIAL RPC proxy. It is reachable and it is
    //                      correct: AUTHENTICATED_USER, rate-limited, and
    //                      restricted by a method allowlist. The server holds
    //                      no keys, so it can relay or drop the payload but
    //                      cannot alter it — any edit invalidates the
    //                      signature. It grants an attacker nothing they could
    //                      not do by posting to a public RPC themselves.
    //
    // A THIRD location means somebody built a new broadcast path, and that is
    // the thing a reviewer needs to see.
    const RELAY_ALLOWED = ["lib/chains/", "app/api/chain/rpc/"];
    const outside = files
      .filter((f) => !RELAY_ALLOWED.some((p) => f.path.startsWith(p)))
      .filter((f) => !f.path.includes("__tests__"))
      .filter((f) => RELAY_METHODS.some((m) => f.code.includes(m)))
      .map((f) => f.path);

    expect(
      outside,
      "A raw-transaction broadcast appeared in a new location. Confirm it is a " +
        "relay of an already-signed payload (not a signing path) and that it is " +
        "authenticated and rate-limited: " + outside.join(", "),
    ).toEqual([]);
  });

  it("keeps the broadcast primitive unreferenced by application code", () => {
    // Found by this ratchet on its first run, and missed by the manual audit:
    // evmAdapter.broadcastTransaction() calls eth_sendRawTransaction when
    // INTEGRATION_MODE=live. It relays a transaction someone else signed, so
    // it is not a signing path — but it IS a money-moving primitive, and today
    // nothing calls it.
    //
    // The day something does, that call site becomes the first place FurlPay
    // can put a transaction on chain, and it needs the same scrutiny a signing
    // path would get: which chain, which account, verified when.
    // Two ways it could become live, both pinned:
    //   1. somebody calls .broadcastTransaction(...) directly, or
    //   2. somebody imports the adapter registry, which is the only door to
    //      the adapter layer and today has zero importers.
    const callers = files
      .filter((f) => !f.path.startsWith("lib/chains/"))
      .filter((f) => !f.path.includes("__tests__"))
      .filter(
        (f) =>
          /\.broadcastTransaction\s*\(/.test(f.code) ||
          /from\s+["'].*chains\/adapterRegistry["']/.test(f.code),
      )
      .map((f) => f.path);

    expect(
      callers,
      "Something now broadcasts a transaction. Confirm the chain is verified " +
        "against the intended network immediately before the call: " +
        callers.join(", "),
    ).toEqual([]);
  });

  it("keeps assertChain exported for the day a signing path lands", () => {
    const connect = readFileSync(join(SRC, "lib/wallet/connect.ts"), "utf8");
    expect(connect).toMatch(/export async function assertChain/);
  });
});
