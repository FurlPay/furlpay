import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  assertChain,
  classifyProviderError,
  connect,
  WalletConnectError,
  __resetInFlight,
  type Connection,
  type ListedWallet,
} from "../connect";

// ---------------------------------------------------------------------------
// Wallet connection: the three failures that actually reach users.
//
//   1. -32002. The user clicks Connect, a popup is already open behind the
//      browser window, and the page says "Internal JSON-RPC error". They retry,
//      get the same thing, and conclude the site is broken — while a perfectly
//      good request waits for them one window away.
//   2. The double click. Two clicks used to mean two eth_requestAccounts
//      calls, and the second one CAUSED the -32002 above. The bug reported its
//      own symptom.
//   3. Signing on the wrong chain. A Connection records the chain at connect
//      time; the user can switch network at any moment and the chainChanged
//      event can be missed. Trusting the cached value is how a Base
//      transaction gets submitted on Ethereum.
// ---------------------------------------------------------------------------

function provider(over: Partial<{ request: (a: { method: string }) => Promise<unknown> }> = {}) {
  return {
    request: over.request ?? (async () => "0x1"),
  };
}

function listed(over: Partial<ListedWallet> = {}): ListedWallet {
  return {
    rdns: "io.metamask",
    name: "MetaMask",
    installed: true,
    ...over,
  } as ListedWallet;
}

beforeEach(() => __resetInFlight());

describe("provider error classification", () => {
  it("maps -32002 to a pending request, not an unknown failure", () => {
    const out = classifyProviderError({ code: -32002, message: "Internal JSON-RPC error" });
    expect(out.kind).toBe("pending");
    expect(out.message).toMatch(/already open/i);
  });

  it("finds a code nested under data.originalError", () => {
    // Some wallets wrap the RPC error one level down when proxying.
    expect(classifyProviderError({ data: { originalError: { code: -32002 } } }).kind).toBe(
      "pending",
    );
  });

  it("maps 4001 to a rejection", () => {
    expect(classifyProviderError({ code: 4001 }).kind).toBe("rejected");
  });

  it("maps 4100 and 4900 to locked, not not-installed", () => {
    // Telling someone to install a wallet they already have is the worst
    // possible instruction here.
    expect(classifyProviderError({ code: 4100 }).kind).toBe("locked");
    expect(classifyProviderError({ code: 4900 }).kind).toBe("locked");
  });

  it("maps 4902 to an unsupported network", () => {
    expect(classifyProviderError({ code: 4902 }).kind).toBe("wrong-network");
  });

  it("never leaks a raw provider message to the user", () => {
    const raw = "Internal JSON-RPC error: execution reverted 0xdeadbeef";
    const out = classifyProviderError({ code: 99999, message: raw });
    expect(out.kind).toBe("unknown");
    expect(out.message).not.toContain("0xdeadbeef");
    expect(out.message).not.toContain("JSON-RPC");
  });

  it("classifies a non-object error without throwing", () => {
    expect(classifyProviderError(undefined).kind).toBe("unknown");
    expect(classifyProviderError("boom").kind).toBe("unknown");
  });
});

describe("double-click deduplication", () => {
  it("issues ONE provider request for two rapid clicks", async () => {
    let resolveAccounts: (v: string[]) => void = () => {};
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") {
        return new Promise<string[]>((res) => {
          resolveAccounts = res;
        });
      }
      return "0x1";
    });

    const wallet = listed({ detail: { info: {}, provider: provider({ request }) } } as never);

    const a = connect(wallet);
    const b = connect(wallet);
    resolveAccounts(["0xAbC0000000000000000000000000000000000001"]);
    await Promise.all([a, b]);

    const accountCalls = request.mock.calls.filter((c) => c[0].method === "eth_requestAccounts");
    expect(accountCalls).toHaveLength(1);
  });

  it("returns the same promise to both callers", async () => {
    const request = vi.fn(async ({ method }: { method: string }) =>
      method === "eth_requestAccounts" ? ["0xAbC0000000000000000000000000000000000001"] : "0x1",
    );
    const wallet = listed({ detail: { info: {}, provider: provider({ request }) } } as never);

    const [a, b] = await Promise.all([connect(wallet), connect(wallet)]);
    expect(a.address).toBe(b.address);
  });

  it("allows a genuine retry after the first attempt fails", async () => {
    let calls = 0;
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") {
        calls += 1;
        if (calls === 1) throw { code: 4001 };
        return ["0xAbC0000000000000000000000000000000000001"];
      }
      return "0x1";
    });
    const wallet = listed({ detail: { info: {}, provider: provider({ request }) } } as never);

    await expect(connect(wallet)).rejects.toThrow(WalletConnectError);
    // The in-flight entry must have cleared, or the user could never retry.
    await expect(connect(wallet)).resolves.toMatchObject({ rdns: "io.metamask" });
    expect(calls).toBe(2);
  });

  it("does not let one wallet block another", async () => {
    const mm = vi.fn(async () => new Promise<string[]>(() => {})); // never settles
    const ph = vi.fn(async ({ method }: { method: string }) =>
      method === "eth_requestAccounts" ? ["0xAbC0000000000000000000000000000000000002"] : "0x1",
    );

    void connect(listed({ rdns: "io.metamask", detail: { info: {}, provider: provider({ request: mm }) } } as never));
    const phantom = await connect(
      listed({ rdns: "app.phantom", detail: { info: {}, provider: provider({ request: ph }) } } as never),
    );
    expect(phantom.rdns).toBe("app.phantom");
  });
});

describe("chain verification before a transaction", () => {
  const conn = (chainHex: string | (() => Promise<unknown>)): Connection =>
    ({
      address: "0xAbC0000000000000000000000000000000000001",
      chainId: 8453,
      rdns: "io.metamask",
      name: "MetaMask",
      provider: provider({
        request: typeof chainHex === "function" ? chainHex : async () => chainHex,
      }),
    }) as Connection;

  it("passes when the wallet is on the expected chain", async () => {
    await expect(assertChain(conn("0x2105"), 8453)).resolves.toBeUndefined();
  });

  it("rejects when the wallet switched away from the expected chain", async () => {
    // The Base-transaction-on-Ethereum case. Same calldata, different contract.
    await expect(assertChain(conn("0x1"), 8453)).rejects.toThrow(WalletConnectError);
  });

  it("names both chains so the user knows what to do", async () => {
    try {
      await assertChain(conn("0x1"), 8453);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as WalletConnectError).kind).toBe("chain-mismatch");
      expect((e as Error).message).toMatch(/Ethereum/);
      expect((e as Error).message).toMatch(/switch network/i);
    }
  });

  it("does NOT trust the chainId cached on the connection", async () => {
    // conn.chainId says 8453; the provider says Ethereum. The live read wins,
    // because a missed chainChanged event is exactly the scenario this guards.
    const stale = conn("0x1");
    expect(stale.chainId).toBe(8453);
    await expect(assertChain(stale, 8453)).rejects.toThrow(/wallet is on/i);
  });

  it("refuses when the wallet will not report its chain", async () => {
    await expect(
      assertChain(
        conn(async () => {
          throw { code: 4900 };
        }),
        8453,
      ),
    ).rejects.toThrow(WalletConnectError);
  });

  it("refuses an unparseable chain id rather than assuming mainnet", async () => {
    await expect(assertChain(conn("not-hex"), 8453)).rejects.toThrow(/did not report/i);
  });
});
