import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFurlBalance, hasSufficientFurl } from "@/lib/token/furlBalance";
import { FURL_MINT, furlToBaseUnits } from "@/lib/token/furl";

// ---------------------------------------------------------------------------
// FURL balance reads.
//
// The distinction these tests exist to protect: "you hold no FURL" and "we could
// not find out" must never render as the same thing. A node timeout reported as
// a zero balance is a false statement about someone's money — and it is the
// default behaviour of almost every naive implementation, because both produce
// an empty array.
// ---------------------------------------------------------------------------

const OWNER = "FgeSXvrWcqE93byDoF3Vhwou7XTUhY42cYhs7vXkJPUL";
const OTHER_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC

const ORIGINAL = { ...process.env };

/** One jsonParsed token account, as getTokenAccountsByOwner returns it. */
function account(mint: string, amount: string, decimals = 6) {
  return {
    account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } },
  };
}

/**
 * Stub the Solana JSON-RPC. `byMethod` maps an RPC method to its `result`; a
 * method whose value is an Error is made to fail, which is how the unreadable
 * -chain cases are exercised.
 */
function stubRpc(byMethod: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const result = byMethod[body.method];
      if (result instanceof Error) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: result.message } }), {
          status: 200,
        });
      }
      if (result === undefined) {
        return new Response("upstream unavailable", { status: 503 });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
    }),
  );
}

/** A getTokenAccountsByOwner result: the account list plus the slot. */
function accountsResponse(accounts: unknown[], slot = 999) {
  return { value: accounts, context: { slot } };
}

beforeEach(() => {
  process.env.SOLANA_RPC_URL = "https://rpc.test.invalid";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.unstubAllGlobals();
});

describe("readFurlBalance", () => {
  it("reports a real Token-2022 balance, in base units and whole FURL", async () => {
    stubRpc({ getTokenAccountsByOwner: accountsResponse([account(FURL_MINT, "2500000000")], 4242) });

    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rawAmount).toBe("2500000000");
    expect(res.amount).toBe("2500"); // 2,500 FURL at 6 decimals
    expect(res.decimals).toBe(6);
    expect(res.mint).toBe(FURL_MINT);
    expect(res.owner).toBe(OWNER);
    expect(res.slot).toBe(4242);
    expect(res.accounts).toBe(1);
  });

  it("queries by MINT, so Token-2022 is covered without naming a program", async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.method).toBe("getTokenAccountsByOwner");
      // The filter is the mint — NOT a program id. Asking by program is how an
      // integration ends up querying legacy SPL and reporting a false zero.
      expect(body.params[1]).toEqual({ mint: FURL_MINT });
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: accountsResponse([]) }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchSpy);
    await readFurlBalance(OWNER);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sums every FURL account the owner holds, not just the first", async () => {
    // An owner can hold the same mint in more than one token account; reporting
    // only one of them under-reports their balance.
    stubRpc({
      getTokenAccountsByOwner: accountsResponse([
        account(FURL_MINT, "1000000"),
        account(FURL_MINT, "2500000"),
      ]),
    });
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rawAmount).toBe("3500000");
    expect(res.amount).toBe("3.5");
    expect(res.accounts).toBe(2);
  });

  it("reports a genuine ZERO when the address holds no FURL", async () => {
    stubRpc({ getTokenAccountsByOwner: accountsResponse([]) });
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rawAmount).toBe("0");
    expect(res.amount).toBe("0");
    expect(res.accounts).toBe(0);
  });

  it("does NOT report zero when the chain is unreadable", async () => {
    stubRpc({ getTokenAccountsByOwner: new Error("429 rate limited") });
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("rpc_error");
    expect(res.detail).toMatch(/rate limited/);
  });

  it("does NOT report zero on an HTTP failure either", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(false);
  });

  it("does NOT report a partial balance when an account fails to parse", async () => {
    stubRpc({
      getTokenAccountsByOwner: accountsResponse([
        account(FURL_MINT, "1000000"),
        { account: { data: { parsed: { info: {} } } } },
      ]),
    });
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.detail).toMatch(/partial balance/);
  });

  it("fails when no RPC is configured, rather than assuming empty", async () => {
    delete process.env.SOLANA_RPC_URL;
    delete process.env.HELIUS_RPC_URL;
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("not_configured");
  });

  it("ignores a non-FURL mint even if the RPC returns one", async () => {
    stubRpc({
      getTokenAccountsByOwner: accountsResponse([
        account(OTHER_MINT, "999000000"),
        account(FURL_MINT, "1000000"),
      ]),
    });
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // A USDC balance must never be surfaced as FURL.
    expect(res.rawAmount).toBe("1000000");
  });

  it("refuses to report a balance whose decimals are not 6", async () => {
    // If the chain ever reported a different scale, every derived amount would
    // be wrong by a power of ten. Refuse rather than display it.
    stubRpc({ getTokenAccountsByOwner: accountsResponse([account(FURL_MINT, "2500000000", 9)]) });
    const res = await readFurlBalance(OWNER);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("decimals_mismatch");
    expect(res.detail).toMatch(/9 decimals/);
  });

  it("rejects a malformed owner address without calling the RPC", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await readFurlBalance("not-an-address");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe("invalid_address");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("hasSufficientFurl", () => {
  const ok = (raw: string) =>
    ({
      ok: true as const,
      owner: OWNER,
      mint: FURL_MINT,
      rawAmount: raw,
      amount: raw,
      decimals: 6,
      slot: 1,
      readAt: new Date().toISOString(),
      accounts: 1,
    });

  it("passes when the balance covers the amount exactly", () => {
    expect(hasSufficientFurl(ok("2500000000"), 2_500_000_000n)).toEqual({ ok: true });
  });

  it("fails one base unit short", () => {
    const res = hasSufficientFurl(ok("2499999999"), 2_500_000_000n);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("insufficient_balance");
  });

  it("does NOT pass when the balance is unknown", () => {
    // Letting a payment through because the check failed is how an unfunded
    // transaction reaches a wallet for signature and dies at the network.
    const res = hasSufficientFurl({ ok: false, error: "rpc_error", detail: "timeout" }, 1n);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("balance_unknown");
  });

  it("rejects a non-positive required amount", () => {
    for (const bad of [0n, -1n]) {
      expect(hasSufficientFurl(ok("1000000"), bad).ok).toBe(false);
    }
  });

  it("stays exact above Number.MAX_SAFE_INTEGER", () => {
    // 9,007,199,254.740993 FURL — the float comparison would say these are equal.
    const held = "9007199254740992";
    const needs = 9_007_199_254_740_993n;
    const res = hasSufficientFurl(ok(held), needs);
    expect(res.ok).toBe(false);
  });

  it("accepts an amount expressed through furlToBaseUnits", () => {
    expect(hasSufficientFurl(ok("12500000"), furlToBaseUnits("12.5"))).toEqual({ ok: true });
    expect(hasSufficientFurl(ok("12499999"), furlToBaseUnits("12.5")).ok).toBe(false);
  });
});
