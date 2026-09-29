import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Address, Hex } from "viem";
import {
  createArcAdapter,
  arcRailAdapter,
  arcChainId,
  assertArcChain,
  ArcChainMismatchError,
  ARC_RAIL_ID,
  ARC_GAS_CEILING,
  type ArcSigner,
  type ArcNetwork,
} from "../arcExecutionAdapter";
import type { RailSubmitRequest } from "@/lib/controlPlane/railAdapter";

// ---------------------------------------------------------------------------
// The Arc rail, attacked.
//
// WHAT IS UNDER TEST is the adapter's DECISION LOGIC, driven against a
// JSON-RPC server that returns exactly the bytes each test chooses. No Arc
// network is contacted, and no test here claims otherwise — Arc has never been
// reached from this repository.
//
// THE TWO INVARIANTS EVERYTHING SERVES:
//
//   1. Never submit to an endpoint that has not proved its chain id. On an EVM
//      chain the same address exists everywhere, so a transfer sent to the
//      wrong chain is well-formed, irreversible, and gone.
//   2. Never report SETTLED for something not observed, and never report
//      REJECTED for something that might have landed. A submitted transaction
//      whose receipt we cannot read is INDETERMINATE — reporting it failed
//      invites a retry that pays twice.
// ---------------------------------------------------------------------------

const TO = "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc";
const HASH = ("0x" + "ab".repeat(32)) as Hex;
const NETWORK: ArcNetwork = "arc_testnet";

type RpcHandler = (method: string, params: unknown[], id: unknown) => unknown;

let server: Server;
let rpcUrl = "";
let handler: RpcHandler;
/** Everything the signer was asked to do. Empty means it was never reached. */
let submissions: { to: Address; amountErc20: bigint; gasLimit: bigint }[] = [];
let signerBehaviour: () => Promise<Hex> = async () => HASH;

const signer: ArcSigner = {
  address: "0x1111111111111111111111111111111111111111" as Address,
  async submitTransfer(input) {
    submissions.push({ to: input.to, amountErc20: input.amountErc20, gasLimit: input.gasLimit });
    return signerBehaviour();
  },
};

const hex = (n: number) => "0x" + n.toString(16);

/** Answers eth_chainId with Arc testnet and every receipt as a success. */
const healthy: RpcHandler = (method, _p, id) => {
  if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: hex(arcChainId(NETWORK)) };
  if (method === "eth_getTransactionReceipt") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        transactionHash: HASH,
        status: "0x1",
        blockNumber: "0x64",
        blockHash: "0x" + "cd".repeat(32),
        gasUsed: "0xafc8", // 45_000
        effectiveGasPrice: "0x4a817c800", // 20 gwei
        logs: [],
        type: "0x2",
        from: signer.address,
        to: TO,
        contractAddress: null,
        transactionIndex: "0x0",
        cumulativeGasUsed: "0xafc8",
        logsBloom: "0x" + "00".repeat(256),
      },
    };
  }
  if (method === "eth_blockNumber") return { jsonrpc: "2.0", id, result: "0x66" };
  if (method === "eth_getBlockByNumber") {
    return { jsonrpc: "2.0", id, result: { number: "0x66", hash: "0x" + "ef".repeat(32) } };
  }
  return { jsonrpc: "2.0", id, result: null };
};

function adapter(confirmations = 1) {
  return createArcAdapter({ network: NETWORK, signer, rpcUrl, confirmations, receiptTimeoutMs: 3_000 });
}

const request = (over: Partial<RailSubmitRequest> = {}): RailSubmitRequest => ({
  organizationId: "org_arc",
  authorizationId: "cpz_arc_1",
  railId: ARC_RAIL_ID,
  amountAtomic: "1000000", // 1.000000 USDC in ERC-20 units
  asset: "USDC",
  networkId: NETWORK,
  destination: TO,
  payloadHash: "a".repeat(64),
  idempotencyKey: "cpexec:org_arc:cpz_arc_1",
  ...over,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: { method: string; params: unknown[]; id: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end("{}");
        return;
      }
      const out = handler(parsed.method, parsed.params ?? [], parsed.id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  submissions = [];
  handler = healthy;
  signerBehaviour = async () => HASH;
});

// ───────────────────────────────────────────────────────────────────────────

describe("the happy path, so the refusals below mean something", () => {
  it("submits an ERC-20 transfer and reports SETTLED with the real hash", async () => {
    const out = await adapter().submit(request());
    expect(out.kind, JSON.stringify(out)).toBe("SETTLED");
    if (out.kind === "SETTLED") {
      expect(out.settlementRef).toBe(HASH);
      // 45_000 * 20 gwei, computed from the receipt rather than estimated.
      expect(out.feeAtomic).toBe(String(45_000n * 20_000_000_000n));
    }
    expect(submissions).toHaveLength(1);
  });

  it("hands the signer the ERC-20 amount, NOT a native-scaled one", async () => {
    // THE 10^12 TRAP. Arc's native interface is 18 decimals and its ERC-20
    // interface is 6. A payment is an ERC-20 transfer, so 1 USDC must reach the
    // signer as 1_000_000 — not 1_000_000_000_000_000_000. Circle's own docs
    // shipped this bug (arc-node #453), and it produces no error, only a value
    // wrong by a factor of a trillion.
    await adapter().submit(request({ amountAtomic: "1000000" }));
    expect(submissions[0].amountErc20).toBe(1_000_000n);
    expect(submissions[0].amountErc20).not.toBe(10n ** 18n);
  });

  it("bounds gas with the ceiling rather than letting the request choose", async () => {
    await adapter().submit(request());
    expect(submissions[0].gasLimit).toBe(ARC_GAS_CEILING);
  });
});

describe("chain identity is proved before anything is signed", () => {
  it("REFUSES when the endpoint reports a different chain, and never reaches the signer", async () => {
    // The attack: a misconfigured or hostile RPC that answers for Base. The
    // destination address is valid on both chains, so nothing about the
    // transfer looks wrong — it simply lands somewhere unrecoverable.
    handler = (method, _p, id) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: hex(8453) };
      return healthy(method, _p, id);
    };
    const out = await adapter().submit(request());
    expect(out.kind).toBe("REJECTED");
    if (out.kind === "REJECTED") expect(out.reason).toMatch(/chain 8453/);
    expect(submissions, "the signer was reached despite a wrong-chain endpoint").toHaveLength(0);
  });

  it("refuses Arc MAINNET's chain id when configured for testnet", async () => {
    // The nastiest version, because both are Arc and both are "correct" chains.
    handler = (method, _p, id) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: hex(5042) };
      return healthy(method, _p, id);
    };
    const out = await adapter().submit(request());
    expect(out.kind).toBe("REJECTED");
    expect(submissions).toHaveLength(0);
  });

  it("an unreachable endpoint is INDETERMINATE, not REJECTED", async () => {
    // We could not ask. That is not the same as being told no — and a previous
    // attempt may have landed.
    const unreachable = createArcAdapter({
      network: NETWORK,
      signer,
      rpcUrl: "http://127.0.0.1:1",
      confirmations: 1,
      receiptTimeoutMs: 3_000,
    });
    const out = await unreachable.submit(request());
    expect(out.kind).toBe("INDETERMINATE");
    expect(submissions).toHaveLength(0);
  }, 60_000);

  it("assertArcChain names the expected chain and leaks no credentials", async () => {
    handler = (method, _p, id) =>
      method === "eth_chainId" ? { jsonrpc: "2.0", id, result: hex(1) } : healthy(method, _p, id);
    // An RPC URL can carry an API key in its path or query; the error must not.
    const withSecret = `${rpcUrl}/v3/super-secret-key?token=alsosecret`;
    await expect(assertArcChain(NETWORK, withSecret)).rejects.toThrow(ArcChainMismatchError);
    await assertArcChain(NETWORK, withSecret).catch((e: Error) => {
      expect(e.message).not.toContain("super-secret-key");
      expect(e.message).not.toContain("alsosecret");
      expect(e.message).toMatch(/127\.0\.0\.1/);
    });
  });
});

describe("the request must match what this adapter actually serves", () => {
  it("refuses a different network", async () => {
    const out = await adapter().submit(request({ networkId: "base" }));
    expect(out.kind).toBe("REJECTED");
    expect(submissions).toHaveLength(0);
  });

  it("refuses a non-USDC asset", async () => {
    const out = await adapter().submit(request({ asset: "USDT" }));
    expect(out.kind).toBe("REJECTED");
    expect(submissions).toHaveLength(0);
  });

  it("refuses every non-decimal amount, without reaching the signer", async () => {
    // The F-9/F-18/F-19 family, at the last gate before a chain write. `BigInt`
    // would accept every one of these.
    for (const amount of ["0x10", "", "   ", "+5", "-5", "1e6", "1.5", "0"]) {
      const out = await adapter().submit(request({ amountAtomic: amount }));
      expect(out.kind, `amount ${JSON.stringify(amount)} was accepted`).toBe("REJECTED");
    }
    expect(submissions).toHaveLength(0);
  });

  it("refuses a malformed destination", async () => {
    for (const to of ["0xnope", "", "not-an-address", TO + "00"]) {
      const out = await adapter().submit(request({ destination: to }));
      expect(out.kind, `destination ${JSON.stringify(to)} was accepted`).toBe("REJECTED");
    }
    expect(submissions).toHaveLength(0);
  });
});

describe("a hash is not a settlement", () => {
  it("a receipt that never arrives is INDETERMINATE and carries the hash", async () => {
    // THE MOST IMPORTANT BRANCH IN THE ADAPTER. The transaction is on the wire
    // and may well succeed. Reporting FAILED here is a lie that costs money,
    // because the caller retries.
    handler = (method, _p, id) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: hex(arcChainId(NETWORK)) };
      // Receipt never materialises.
      return { jsonrpc: "2.0", id, result: null };
    };
    const out = await adapter().submit(request());
    expect(out.kind).toBe("INDETERMINATE");
    if (out.kind === "INDETERMINATE") {
      // The hash must survive, or the payment cannot be reconciled at all.
      expect(out.railRef).toBe(HASH);
      expect(out.reason).toMatch(/submitted/i);
    }
  }, 60_000);

  it("a REVERTED receipt is REJECTED — that one we did observe", async () => {
    handler = (method, p, id) => {
      const base = healthy(method, p, id) as { result?: Record<string, unknown> };
      if (method === "eth_getTransactionReceipt" && base.result) {
        return { jsonrpc: "2.0", id, result: { ...base.result, status: "0x0" } };
      }
      return base;
    };
    const out = await adapter().submit(request());
    expect(out.kind).toBe("REJECTED");
    if (out.kind === "REJECTED") expect(out.reason).toMatch(/reverted/);
  });

  it("a signer that throws is INDETERMINATE unless the failure is permanent", async () => {
    signerBehaviour = async () => {
      throw new Error("socket hang up");
    };
    const out = await adapter().submit(request());
    expect(out.kind).toBe("INDETERMINATE");
  });

  it("a signer returning no usable hash is INDETERMINATE, never SETTLED", async () => {
    // "Done, but I cannot tell you what I did" is not done.
    for (const bad of ["", "0x", "not-a-hash", "0x123"]) {
      signerBehaviour = async () => bad as Hex;
      const out = await adapter().submit(request());
      expect(out.kind, `signer returned ${JSON.stringify(bad)}`).toBe("INDETERMINATE");
    }
  });
});

describe("the rail refuses to register itself without real infrastructure", () => {
  it("arcRailAdapter() is null today — no signer exists", () => {
    // This is the honest current state, and the seam turns it into a 503
    // rail_not_connected rather than anything that looks like a payment.
    expect(arcRailAdapter()).toBeNull();
  });

  it("stays null even if the flag and an RPC are set, because the signer is the gate", () => {
    const prev = { ...process.env };
    process.env.ARC_RAIL_LIVE = "1";
    process.env.ARC_TESTNET_RPC_URL = rpcUrl;
    try {
      expect(arcRailAdapter()).toBeNull();
    } finally {
      process.env = prev;
    }
  });

  it("mainnet needs its own activation on top of everything else", () => {
    // Two gates, deliberately. A flag that enables "Arc" must not silently
    // enable Arc MAINNET.
    expect(process.env.ARC_MAINNET_ACTIVATED).not.toBe("1");
    expect(arcRailAdapter()).toBeNull();
  });
});
