import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "../evm/rlp";
import { signingHash, type Eip1559Transaction } from "../evm/transaction";
import { MpcSigner } from "../signing/mpcSigner";
import { MpcSignRefused, RemoteMpcBackend } from "../signing/remoteMpcBackend";

// ---------------------------------------------------------------------------
// The full MPC chain, device side: MpcSigner → RemoteMpcBackend → /api/mpc/sign.
//
// The app holds NO Turnkey credential — only a session. What it does hold, and
// must, is the transaction, the digest, and the verification that the returned
// signature recovers to the expected address. The server is the other party to
// the key split, so a check performed by the server about the server proves
// nothing.
// ---------------------------------------------------------------------------

jest.mock("../api", () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return { api: jest.fn(), ApiError, NetworkError: class extends Error {} };
});

const { api, ApiError } = require("../api") as { api: jest.Mock; ApiError: any };

const PRIV = hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe512961708279f1f4e0a1f2f9c0e2b1");
const ADDRESS = bytesToHex(keccak_256(secp256k1.getPublicKey(PRIV, false).slice(1)).slice(-20));

const TX: Eip1559Transaction = {
  chainId: 42161,
  nonce: 1n,
  maxPriorityFeePerGas: 1n,
  maxFeePerGas: 100n,
  gasLimit: 21000n,
  to: "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae",
  value: 0n,
  data: "0xdeadbeef",
};

/** Signs like the server would, returning Turnkey's r/s/v string shape. */
function serverSignature(digest: Uint8Array, key = PRIV, vStyle: "parity" | "legacy" = "parity") {
  const sig = secp256k1.sign(digest, key);
  const v = vStyle === "parity" ? sig.recovery : sig.recovery + 27;
  return {
    r: sig.r.toString(16).padStart(64, "0"),
    s: sig.s.toString(16).padStart(64, "0"),
    v: v.toString(16).padStart(2, "0"),
  };
}

beforeEach(() => api.mockReset());

describe("the happy path, end to end", () => {
  it("signs through the server and assembles locally", async () => {
    api.mockImplementation(async (_path: string, opts: any) =>
      serverSignature(hexToBytes(opts.body.digest))
    );

    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS, label: "Turnkey" }));
    const signed = await signer.signTransaction(TX);

    expect(signed.raw.startsWith("0x02")).toBe(true);
    expect(signed.from.toLowerCase()).toBe(ADDRESS.toLowerCase());
  });

  it("sends OUR digest, and never a serialized transaction", async () => {
    api.mockImplementation(async (_path: string, opts: any) =>
      serverSignature(hexToBytes(opts.body.digest))
    );

    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);

    const body = api.mock.calls[0][1].body;
    expect(body.digest).toBe(bytesToHex(signingHash(TX)));
    // Nothing the server could substitute a transaction with.
    expect(body).not.toHaveProperty("raw");
    expect(body).not.toHaveProperty("transaction");
  });

  it("accepts both Turnkey v conventions", async () => {
    for (const style of ["parity", "legacy"] as const) {
      api.mockImplementation(async (_p: string, opts: any) =>
        serverSignature(hexToBytes(opts.body.digest), PRIV, style)
      );
      const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
      await expect(signer.signTransaction(TX)).resolves.toBeDefined();
    }
  });

  it("forwards the agent key so server-side policy applies", async () => {
    api.mockImplementation(async (_p: string, opts: any) =>
      serverSignature(hexToBytes(opts.body.digest))
    );

    await new MpcSigner(
      new RemoteMpcBackend({ signWith: ADDRESS, agentKeyId: "agent-1", category: "x402" })
    ).signTransaction(TX);

    const body = api.mock.calls[0][1].body;
    expect(body.agentKeyId).toBe("agent-1");
    expect(body.context.category).toBe("x402");
    expect(body.context.chainId).toBe(42161);
  });
});

describe("a server that returns the wrong signature", () => {
  it("is caught on the device, not on-chain", async () => {
    const impostor = hexToBytes(
      "0x8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b4c1e9f"
    );
    api.mockImplementation(async (_p: string, opts: any) =>
      serverSignature(hexToBytes(opts.body.digest), impostor)
    );

    // The server IS the counterparty to the key split. Trusting it to confirm
    // it used the right key would defeat the arrangement.
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/unexpected key/i);
  });

  it("rejects a signature over bytes we did not send", async () => {
    api.mockImplementation(async () =>
      serverSignature(keccak_256(new Uint8Array([9, 9, 9])))
    );
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/unexpected key/i);
  });

  it("rejects a malformed signature rather than serializing it", async () => {
    api.mockResolvedValue({ r: "zz", s: "zz", v: "00" });
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/malformed|unexpected/i);
  });
});

describe("policy refusals are final and readable", () => {
  const refusal = (detail: string) =>
    api.mockRejectedValue(new ApiError(403, "forbidden", { error: "policy_denied", detail }));

  it("translates each reason into something actionable", async () => {
    const cases: [string, RegExp][] = [
      ["per_tx_limit_exceeded", /per-transaction limit/i],
      ["daily_budget_exceeded", /daily budget/i],
      ["category_not_allowed", /isn't allowed to spend/i],
      ["key_revoked", /revoked/i],
      ["key_expired", /expired/i],
      ["key_not_owned", /different account/i],
    ];
    for (const [reason, expected] of cases) {
      refusal(reason);
      const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
      await expect(signer.signTransaction(TX)).rejects.toThrow(expected);
    }
  });

  it("says nothing was signed when the budget counter is down", async () => {
    // The server fails CLOSED here. The copy must not imply a limit was hit —
    // it must say the check itself was unavailable.
    refusal("budget_counter_unavailable");
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/nothing was signed/i);
  });

  it("distinguishes 'needs another approval' from a refusal", async () => {
    // Turnkey quorum: a real state, not a failure to retry blindly.
    api.mockRejectedValue(new ApiError(202, "pending", { detail: "awaiting" }));
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toBeInstanceOf(MpcSignRefused);
    await expect(signer.signTransaction(TX)).rejects.toThrow(/another approval/i);
  });

  it("reports an unconfigured deployment as unavailable, not denied", async () => {
    api.mockRejectedValue(new ApiError(503, "unavailable", { error: "mpc_unavailable" }));
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/isn't available/i);
  });
});

describe("client-side policy still applies over the remote backend", () => {
  it("never reaches the network for an out-of-policy transaction", async () => {
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }), {
      allowedChainIds: [8453],
    });
    await expect(signer.signTransaction(TX)).rejects.toThrow(/isn't authorised/i);
    // Two independent gates: the client declines to ask at all.
    expect(api).not.toHaveBeenCalled();
  });
});
