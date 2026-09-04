import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/payouts/validate-destination/route";

// ---------------------------------------------------------------------------
// The validation endpoint the Add Wallet UI calls.
//
// The panel is only "not a mockup" if this route really runs the payout
// engine's own checks. These tests drive the exported handler directly, so a
// future refactor that quietly swaps the real validator for something
// permissive fails here rather than in production.
// ---------------------------------------------------------------------------

const post = (body: unknown) =>
  POST(
    new NextRequest("https://furlpay.com/api/payouts/validate-destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TAPROOT = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";

describe("POST /api/payouts/validate-destination", () => {
  it("accepts a valid EVM destination and reports what the UI needs", async () => {
    const body = await (await post({ rail: "EVM", network: "base", destination: EVM })).json();
    expect(body.ok).toBe(true);
    expect(body.assetSymbol).toBe("USDC");
    expect(body.decimals).toBe(6);
    // The UI must show a confirmation step for an ambiguous format.
    expect(body.requiresNetworkConfirmation).toBe(true);
    expect(body.ownership).toBe("supported");
  });

  it("identifies a Taproot address and its 8 decimals", async () => {
    const body = await (
      await post({ rail: "BITCOIN_ONCHAIN", network: "bitcoin:mainnet", destination: TAPROOT })
    ).json();
    expect(body.ok).toBe(true);
    expect(body.addressType).toBe("p2tr");
    expect(body.decimals).toBe(8);
    // A Bitcoin address names its own network, so nothing needs confirming.
    expect(body.requiresNetworkConfirmation).toBe(false);
    // And it says plainly that it cannot prove ownership on this rail yet.
    expect(body.ownership).toBe("not_implemented");
  });

  it("refuses an EVM address on a Solana rail", async () => {
    const body = await (await post({ rail: "SOLANA", network: "solana", destination: EVM })).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("wrong_format_for_network");
  });

  it("refuses a Bitcoin address on the EVM rail", async () => {
    const body = await (await post({ rail: "EVM", network: "base", destination: TAPROOT })).json();
    expect(body.ok).toBe(false);
  });

  it("refuses a rail that is not implemented rather than pretending", async () => {
    const body = await (
      await post({ rail: "BITCOIN_LIGHTNING", network: "bitcoin:mainnet", destination: "lnbc1..." })
    ).json();
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("rail_not_implemented");
  });

  it("answers 200 for a rejected address, not 4xx", async () => {
    // A typo in a half-filled form is a normal outcome, not a client error —
    // and a 4xx would make every mistyped character look like a broken
    // integration in the console.
    const res = await post({ rail: "EVM", network: "base", destination: "0xnope" });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(false);
  });

  it("rejects a malformed request body with 400", async () => {
    const res = await post({ rail: "NOT_A_RAIL", network: "base", destination: EVM });
    expect(res.status).toBe(400);
  });

  it("never echoes a stored secret or account detail", async () => {
    // The endpoint is unauthenticated by design: it must tell the caller only
    // what is already true of the string they sent.
    const text = await (await post({ rail: "SOLANA", network: "solana", destination: SOL })).text();
    expect(text).not.toMatch(/userId|secret|token|key"/i);
  });
});
