import { describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { ARC_USDC_ERC20 } from "../chains/arc";
import {
  ARC_IS_BLACKLISTED_SELECTOR,
  ARC_TESTNET_BLOCKED_TEST_ADDRESS,
  arcEthCallViaRpc,
  ArcScreeningError,
  assertArcPartiesClear,
  screenArcAddress,
  type ArcEthCall,
} from "../chains/arcCompliance";

// ---------------------------------------------------------------------------
// Screening on Arc, against the contract that enforces.
//
// The behaviour being pinned is not "does it parse a bool" — it is that there is
// NO PATH from an unanswered check to a passed one. Every branch that cannot
// obtain a definite answer must report `unknown`, and `unknown` must refuse.
//
// The values below were measured on both Arc networks 2026-09-25:
//   testnet  isBlacklisted(0x7099…79C8) -> true   (Arc's published test address)
//   mainnet  isBlacklisted(0x7099…79C8) -> false
// ---------------------------------------------------------------------------

const CLEAR_ADDR = "0x8b1332e6414c830e823110667a6f0c10463d0f98";
const TRUE_WORD = `0x${"0".repeat(63)}1`;
const FALSE_WORD = `0x${"0".repeat(64)}`;

const ok = (word: string): ArcEthCall => async () => word;

describe("the screening call itself", () => {
  it("asks Circle's USDC contract, not a third party", () => {
    // The whole argument for this approach: the list queried IS the list that
    // reverts the transfer, so there is no divergence to reconcile.
    const seen: { to: string; data: string }[] = [];
    const spy: ArcEthCall = async (req) => {
      seen.push(req);
      return FALSE_WORD;
    };
    return screenArcAddress(CLEAR_ADDR, spy).then((result) => {
      expect(seen).toHaveLength(1);
      expect(seen[0].to).toBe(ARC_USDC_ERC20);
      expect(result.source).toBe(ARC_USDC_ERC20);
    });
  });

  it("encodes isBlacklisted(address) correctly", () => {
    const seen: string[] = [];
    const spy: ArcEthCall = async ({ data }) => {
      seen.push(data);
      return FALSE_WORD;
    };
    return screenArcAddress(CLEAR_ADDR, spy).then(() => {
      // selector + 12 zero bytes of padding + the 20-byte address, lowercased.
      expect(seen[0]).toBe(`${ARC_IS_BLACKLISTED_SELECTOR}${"0".repeat(24)}${CLEAR_ADDR.slice(2)}`);
      expect(seen[0]).toHaveLength(10 + 64);
    });
  });

  it("reads a true word as blocked and a false word as clear", async () => {
    expect((await screenArcAddress(ARC_TESTNET_BLOCKED_TEST_ADDRESS, ok(TRUE_WORD))).status).toBe(
      "blocked"
    );
    expect((await screenArcAddress(CLEAR_ADDR, ok(FALSE_WORD))).status).toBe("clear");
  });

  it("stamps when the answer was obtained", async () => {
    // A blocklist answer is only true as of an instant. A cached "clear" with no
    // timestamp cannot be reasoned about later.
    const result = await screenArcAddress(CLEAR_ADDR, ok(FALSE_WORD));
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
  });

  it("normalises the address to its checksummed form", async () => {
    // Screening results get logged and compared. An address that arrives
    // uppercased from one caller and lowercased from another must not produce two
    // different-looking records of the same screening decision.
    const canonical = getAddress(CLEAR_ADDR);
    for (const spelling of [
      CLEAR_ADDR,
      CLEAR_ADDR.toUpperCase().replace("0X", "0x"),
      `  ${canonical}  `,
    ]) {
      const result = await screenArcAddress(spelling, ok(FALSE_WORD));
      expect(result.address, spelling).toBe(canonical);
    }
  });

  it("throws on something that is not an address at all", async () => {
    // A programming error, not a screening outcome — so it is not laundered into
    // an `unknown` that a caller might log and move past.
    await expect(screenArcAddress("not-an-address", ok(FALSE_WORD))).rejects.toThrow();
  });
});

describe("every unanswerable check reports unknown, never clear", () => {
  it("on an RPC that throws", async () => {
    const result = await screenArcAddress(CLEAR_ADDR, async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(result.status).toBe("unknown");
    expect(result.reason).toMatch(/ECONNREFUSED/);
  });

  it("on an empty return, which means we are not talking to Arc's USDC", async () => {
    // We MEASURED that the function exists on both Arc networks. An empty return
    // therefore is not "no opinion" — it means the RPC or the address is wrong,
    // and reporting `clear` would be inventing an answer.
    const result = await screenArcAddress(CLEAR_ADDR, ok("0x"));
    expect(result.status).toBe("unknown");
    expect(result.reason).toMatch(/returned no data/);
  });

  it("on a value that is not a boolean", async () => {
    // 2 is not true and not false. Rounding it either way silently is exactly
    // the decision that should never be made silently.
    const result = await screenArcAddress(CLEAR_ADDR, ok(`0x${"0".repeat(63)}2`));
    expect(result.status).toBe("unknown");
    expect(result.reason).toMatch(/not a boolean/);
  });

  it("on an unparseable result", async () => {
    const result = await screenArcAddress(CLEAR_ADDR, ok("garbage"));
    expect(result.status).toBe("unknown");
  });

  it("never returns clear from any failure path", async () => {
    // The invariant, stated as a sweep so a future branch cannot quietly become
    // the exception.
    const failures: ArcEthCall[] = [
      async () => {
        throw new Error("boom");
      },
      ok("0x"),
      ok("garbage"),
      ok(`0x${"0".repeat(63)}2`),
      ok(`0x${"f".repeat(64)}`),
    ];
    for (const call of failures) {
      const result = await screenArcAddress(CLEAR_ADDR, call);
      expect(result.status, result.reason).not.toBe("clear");
    }
  });
});

describe("refusing a transfer — both parties, fail closed", () => {
  const parties = [
    { role: "payer", address: CLEAR_ADDR },
    { role: "recipient", address: ARC_TESTNET_BLOCKED_TEST_ADDRESS },
  ];

  it("screens BOTH sides, because Arc reverts on either", async () => {
    // Screening only the recipient leaves the sender's status to be discovered
    // as a failed receipt, after gas has been spent.
    const seen: string[] = [];
    const spy: ArcEthCall = async ({ data }) => {
      seen.push(data.slice(-40));
      return FALSE_WORD;
    };
    await assertArcPartiesClear(parties, spy);
    expect(seen).toHaveLength(2);
    expect(seen).toContain(CLEAR_ADDR.slice(2));
    expect(seen).toContain(ARC_TESTNET_BLOCKED_TEST_ADDRESS.slice(2).toLowerCase());
  });

  it("throws on a blocked party and says not to retry", async () => {
    // A blocklist is a standing issuer decision. Retrying burns gas forever and
    // tells the user nothing, so the message has to say so.
    const call: ArcEthCall = async ({ data }) =>
      data.endsWith(ARC_TESTNET_BLOCKED_TEST_ADDRESS.slice(2).toLowerCase()) ? TRUE_WORD : FALSE_WORD;

    await expect(assertArcPartiesClear(parties, call)).rejects.toThrow(ArcScreeningError);
    await expect(assertArcPartiesClear(parties, call)).rejects.toThrow(/do not retry/i);
    // Names which party, which is what an operator needs first.
    await expect(assertArcPartiesClear(parties, call)).rejects.toThrow(/recipient/);
  });

  it("throws on unknown too — an unanswered check is not a passed one", async () => {
    const err = await assertArcPartiesClear(parties, async () => {
      throw new Error("timeout");
    }).catch((e) => e as ArcScreeningError);

    expect(err).toBeInstanceOf(ArcScreeningError);
    expect(err.message).toMatch(/Refusing rather than assuming clear/);
    expect(err.result.status).toBe("unknown");
  });

  it("carries the result on the error so a caller can record what was checked", async () => {
    const call: ArcEthCall = async () => TRUE_WORD;
    const err = await assertArcPartiesClear([{ role: "payer", address: CLEAR_ADDR }], call).catch(
      (e) => e as ArcScreeningError
    );
    expect(err.result.status).toBe("blocked");
    expect(err.result.source).toBe(ARC_USDC_ERC20);
    expect(Date.parse(err.result.checkedAt)).not.toBeNaN();
  });

  it("returns a result per party when all are clear", async () => {
    const results = await assertArcPartiesClear(parties, ok(FALSE_WORD));
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "clear")).toBe(true);
  });

  it("stops at the FIRST blocked party rather than screening on", async () => {
    // Not an optimisation — once one party is blocked the transfer cannot
    // proceed, and continuing to query is a pointless extra RPC round trip per
    // remaining party on a path that is already refused.
    let calls = 0;
    const call: ArcEthCall = async () => {
      calls++;
      return TRUE_WORD;
    };
    await expect(assertArcPartiesClear(parties, call)).rejects.toThrow(ArcScreeningError);
    expect(calls).toBe(1);
  });
});

describe("the JSON-RPC transport", () => {
  it("posts a well-formed eth_call and returns the result", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.method).toBe("eth_call");
      expect(body.params[1]).toBe("latest");
      expect(body.params[0].to).toBe(ARC_USDC_ERC20);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: FALSE_WORD }), {
        status: 200,
      });
    });

    const call = arcEthCallViaRpc("https://rpc.mainnet.arc.io", fetchImpl as unknown as typeof fetch);
    expect(await call({ to: ARC_USDC_ERC20, data: "0xfe575a87" })).toBe(FALSE_WORD);
  });

  it("surfaces an RPC-level error rather than returning empty", async () => {
    // Returning "0x" here would be downgraded to `unknown` anyway, but an error
    // carries the reason and an empty result does not.
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "rate limited" } }), {
          status: 200,
        })
    );
    const call = arcEthCallViaRpc("https://rpc.mainnet.arc.io", fetchImpl as unknown as typeof fetch);
    await expect(call({ to: ARC_USDC_ERC20, data: "0x" })).rejects.toThrow(/rate limited/);
  });

  it("treats a non-200 as an error", async () => {
    const fetchImpl = vi.fn(async () => new Response("gateway timeout", { status: 504 }));
    const call = arcEthCallViaRpc("https://rpc.mainnet.arc.io", fetchImpl as unknown as typeof fetch);
    await expect(call({ to: ARC_USDC_ERC20, data: "0x" })).rejects.toThrow(/504/);
  });
});
