import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "../evm/rlp";
import { signingHash, type Eip1559Transaction } from "../evm/transaction";
import { MpcSigner } from "../signing/mpcSigner";
import { MpcSignRefused, RemoteMpcBackend } from "../signing/remoteMpcBackend";

// ---------------------------------------------------------------------------
// The full MPC chain, device side:
//
//   MpcSigner → RemoteMpcBackend → prepare → confirm → authorize → sign
//
// The app holds NO Turnkey credential — only a session. What it does hold, and
// must, is the transaction and the verification that the returned signature
// recovers to the expected address. The server is the other party to the key
// split, so a check performed by the server about the server proves nothing.
//
// WHAT CHANGED, AND WHY THESE TESTS LOOK DIFFERENT (FURL-003). The old client
// POSTed `{ signWith, digest, context }` with a hardcoded `amountUsd: 0`, and
// the server priced the agent spend policy from it. Every agent signature
// passed the cap and consumed zero budget. The server no longer accepts a
// digest at all, so the first assertion below is that we never send one.
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

jest.mock("../device/registration", () => ({
  requireIdentity: jest.fn(async () => ({
    deviceId: "dev_" + "a".repeat(32),
    appInstanceId: "inst_" + "b".repeat(32),
  })),
  DeviceNotEnrolled: class extends Error {},
}));

// Device-owner auth is a system prompt; the tests drive it explicitly.
jest.mock("../biometrics", () => ({
  authenticateDeviceOwner: jest.fn(async () => ({ ok: true })),
}));

const { api, ApiError } = require("../api") as { api: jest.Mock; ApiError: any };
const { authenticateDeviceOwner } = require("../biometrics") as {
  authenticateDeviceOwner: jest.Mock;
};

const PRIV = hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe512961708279f1f4e0a1f2f9c0e2b1");
const ADDRESS = bytesToHex(keccak_256(secp256k1.getPublicKey(PRIV, false).slice(1)).slice(-20));

const USDC_ARBITRUM = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const ALICE = "0x1111111111111111111111111111111111111111";

function transferCalldata(to: string, amount: bigint): string {
  return (
    "0xa9059cbb" +
    to.replace(/^0x/, "").toLowerCase().padStart(64, "0") +
    amount.toString(16).padStart(64, "0")
  );
}

/** 10 USDC to Alice on Arbitrum. Describable, and therefore preparable. */
const TX: Eip1559Transaction = {
  chainId: 42161,
  nonce: 1n,
  maxPriorityFeePerGas: 1n,
  maxFeePerGas: 100n,
  gasLimit: 120000n,
  to: USDC_ARBITRUM,
  value: 0n,
  data: transferCalldata(ALICE, 10_000_000n),
};

const SUMMARY = {
  action: "transfer",
  chain: "arbitrum",
  assetId: "USDC.arbitrum",
  amountMinor: "10000000",
  destination: ALICE,
  spender: null,
  maxFeeWei: "12000000",
  simulation: { outcome: "unavailable", summary: "not checked", warnings: [] as string[] },
};

const PREPARED = {
  intentId: "itx_" + "c".repeat(32),
  canonicalDigest: "d".repeat(64),
  transactionVersion: 2,
  expiresAt: Date.now() + 600_000,
  confirmation: { challengeId: "chal_" + "1".repeat(32), nonce: "N".repeat(43), expiresAt: 0 },
  summary: SUMMARY,
};

const AUTHORIZED = {
  authorizationId: "auth_" + "e".repeat(32),
  expiresAt: Date.now() + 120_000,
  transactionVersion: 2,
  signing: { challengeId: "chal_" + "2".repeat(32), nonce: "M".repeat(43) },
  warnings: [] as string[],
  integrity: { verdict: "unsupported" },
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

/**
 * A server that behaves.
 *
 * The signature is produced over the digest the DEVICE computed, which is what
 * the real server does independently from its own stored payload — the two
 * derivations must land on the same bytes or MpcSigner's recovery check fails.
 */
function healthyServer(over: { sign?: () => unknown } = {}) {
  api.mockImplementation(async (path: string) => {
    if (path === "/transactions/prepare") return PREPARED;
    if (path === "/transactions/authorize") return AUTHORIZED;
    if (path === "/mpc/sign") return (over.sign ?? (() => serverSignature(signingHash(TX))))();
    throw new Error(`unexpected path ${path}`);
  });
}

const bodyFor = (path: string) =>
  api.mock.calls.find((c: unknown[]) => c[0] === path)?.[1].body;

beforeEach(() => {
  api.mockReset();
  authenticateDeviceOwner.mockReset();
  authenticateDeviceOwner.mockResolvedValue({ ok: true });
});

describe("the happy path, end to end", () => {
  it("signs through the server and assembles locally", async () => {
    healthyServer();
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS, label: "Turnkey" }));
    const signed = await signer.signTransaction(TX);

    expect(signed.raw.startsWith("0x02")).toBe(true);
    expect(signed.from.toLowerCase()).toBe(ADDRESS.toLowerCase());
  });

  it("runs prepare, then authorize, then sign — in that order", async () => {
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);
    expect(api.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      "/transactions/prepare",
      "/transactions/authorize",
      "/mpc/sign",
    ]);
  });

  it("NEVER sends a digest, a raw transaction, or a client-priced amount", async () => {
    // FURL-001 and FURL-002 in one assertion. The old contract let a caller
    // choose the bytes AND the number the spend policy was priced from.
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);

    const sign = bodyFor("/mpc/sign");
    expect(sign).not.toHaveProperty("digest");
    expect(sign).not.toHaveProperty("raw");
    expect(sign).not.toHaveProperty("transaction");
    expect(sign).not.toHaveProperty("context");
    expect(JSON.stringify(sign)).not.toContain("amountUsd");
  });

  it("proposes the transaction it actually built", async () => {
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);

    const prepare = bodyFor("/transactions/prepare");
    expect(prepare.payload).toEqual({
      chainId: 42161,
      nonce: 1,
      gasLimit: "120000",
      maxFeePerGas: "100",
      maxPriorityFeePerGas: "1",
      to: USDC_ARBITRUM,
      value: "0",
      data: TX.data,
    });
    // The description is a proposal the server re-derives and can refuse.
    expect(prepare.action).toBe("transfer");
    expect(prepare.assetId).toBe("USDC.arbitrum");
    expect(prepare.amountMinor).toBe("10000000");
    expect(prepare.destination).toBe(ALICE);
  });

  it("echoes the digest it DISPLAYED, and carries the challenges through", async () => {
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);

    const authorize = bodyFor("/transactions/authorize");
    expect(authorize.displayedDigest).toBe(PREPARED.canonicalDigest);
    expect(authorize.challengeId).toBe(PREPARED.confirmation.challengeId);
    expect(authorize.challengeNonce).toBe(PREPARED.confirmation.nonce);

    // The SIGNING challenge is a different one, issued at authorize.
    const sign = bodyFor("/mpc/sign");
    expect(sign.challengeId).toBe(AUTHORIZED.signing.challengeId);
    expect(sign.challengeId).not.toBe(PREPARED.confirmation.challengeId);
    expect(sign.authorizationId).toBe(AUTHORIZED.authorizationId);
    expect(sign.intentId).toBe(PREPARED.intentId);
  });

  it("binds the device and app instance at every step", async () => {
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);
    for (const path of ["/transactions/prepare", "/transactions/authorize", "/mpc/sign"]) {
      // Named in the failure message: jest has no per-assertion label, and
      // "expected undefined" across three identical lines is unreadable.
      expect({ path, id: bodyFor(path).deviceId }).toEqual({
        path,
        id: expect.stringMatching(/^dev_[0-9a-f]{32}$/),
      });
      expect({ path, id: bodyFor(path).appInstanceId }).toEqual({
        path,
        id: expect.stringMatching(/^inst_[0-9a-f]{32}$/),
      });
    }
  });

  it("sends NO integrity block rather than a fabricated one", async () => {
    // Play Integrity is not wired into this app. Absent is a state the server
    // supports and weighs; a fake token would be treated as tampering.
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);
    expect(bodyFor("/transactions/authorize").integrity).toBeUndefined();
  });

  it("accepts both Turnkey v conventions", async () => {
    for (const style of ["parity", "legacy"] as const) {
      api.mockReset();
      healthyServer({ sign: () => serverSignature(signingHash(TX), PRIV, style) });
      const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
      await expect(signer.signTransaction(TX)).resolves.toBeDefined();
    }
  });

  it("forwards the agent key so server-side policy applies", async () => {
    healthyServer();
    await new MpcSigner(
      new RemoteMpcBackend({ signWith: ADDRESS, agentKeyId: "agent-1", category: "x402" })
    ).signTransaction(TX);
    expect(bodyFor("/mpc/sign").agentKeyId).toBe("agent-1");
  });
});

describe("user confirmation gates the authorization", () => {
  it("prepares, then asks, then authorizes", async () => {
    healthyServer();
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);
    expect(authenticateDeviceOwner).toHaveBeenCalledTimes(1);
  });

  it("STOPS before authorize when the user declines", async () => {
    // A decline must leave nothing authorised. If authorize ran first, a
    // refusal would arrive after the server had already minted a ticket.
    healthyServer();
    authenticateDeviceOwner.mockResolvedValue({ ok: false, reason: "rejected" });

    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/declined/i);
    expect(api.mock.calls.map((c: unknown[]) => c[0])).toEqual(["/transactions/prepare"]);
  });

  it("STOPS when the device has no lock at all", async () => {
    healthyServer();
    authenticateDeviceOwner.mockResolvedValue({ ok: false, reason: "no_device_lock" });
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toBeInstanceOf(MpcSignRefused);
  });

  it("shows the SERVER's summary, not the app's own description", async () => {
    // Approving our own rendering of our own description would be the app
    // agreeing with itself.
    healthyServer();
    const confirm = jest.fn(async () => true);
    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS, confirm })).signTransaction(TX);
    expect(confirm).toHaveBeenCalledWith(SUMMARY);
  });

  it("puts a simulation warning in front of the user at the moment they decide", async () => {
    api.mockImplementation(async (path: string) => {
      if (path === "/transactions/prepare") {
        return {
          ...PREPARED,
          summary: {
            ...SUMMARY,
            simulation: { ...SUMMARY.simulation, warnings: ["Unlimited spending approval"] },
          },
        };
      }
      if (path === "/transactions/authorize") return AUTHORIZED;
      return serverSignature(signingHash(TX));
    });

    await new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS })).signTransaction(TX);
    // A warning rendered behind the system dialog is a warning nobody reads.
    expect(authenticateDeviceOwner.mock.calls[0][0]).toMatch(/Unlimited spending approval/);
  });
});

describe("transactions this app cannot describe are refused before the network", () => {
  it("REFUSES unknown calldata", async () => {
    // A description we cannot justify from the bytes would be shown to the
    // user as fact. Better to refuse.
    healthyServer();
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(
      signer.signTransaction({ ...TX, data: "0xdeadbeef" })
    ).rejects.toThrow(/not a plain transfer or approval/i);
    expect(api).not.toHaveBeenCalled();
  });

  it("REFUSES an unrecognised contract", async () => {
    healthyServer();
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(
      signer.signTransaction({ ...TX, to: "0x2222222222222222222222222222222222222222" })
    ).rejects.toThrow(/does not recognise/i);
    expect(api).not.toHaveBeenCalled();
  });

  it("REFUSES a chain with no pinned token table", async () => {
    healthyServer();
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction({ ...TX, chainId: 999 })).rejects.toThrow(/not one this app can describe/i);
    expect(api).not.toHaveBeenCalled();
  });

  it("REFUSES native value smuggled alongside a token transfer", async () => {
    healthyServer();
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction({ ...TX, value: 1n })).rejects.toThrow(
      /native currency alongside a token transfer/i
    );
  });
});

describe("a server that returns the wrong signature", () => {
  it("is caught on the device, not on-chain", async () => {
    const impostor = hexToBytes(
      "0x8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b4c1e9f"
    );
    healthyServer({ sign: () => serverSignature(signingHash(TX), impostor) });

    // The server IS the counterparty to the key split. Trusting it to confirm
    // it used the right key would defeat the arrangement.
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/unexpected key/i);
  });

  it("rejects a signature over bytes we did not build", async () => {
    // The server derives the signing hash from ITS stored payload. If those
    // bytes are not the ones we built, recovery fails here — which is what
    // makes it safe for the client not to send a digest.
    healthyServer({ sign: () => serverSignature(keccak_256(new Uint8Array([9, 9, 9]))) });
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/unexpected key/i);
  });

  it("rejects a malformed signature rather than serializing it", async () => {
    healthyServer({ sign: () => ({ r: "zz", s: "zz", v: "00" }) });
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/malformed|unexpected/i);
  });
});

describe("policy refusals are final and readable", () => {
  function refuseAt(path: string, error: any) {
    api.mockImplementation(async (p: string) => {
      if (p === path) throw error;
      if (p === "/transactions/prepare") return PREPARED;
      if (p === "/transactions/authorize") return AUTHORIZED;
      return serverSignature(signingHash(TX));
    });
  }

  it("translates each reason into something actionable", async () => {
    const cases: [string, RegExp][] = [
      ["per_tx_limit_exceeded", /per-transaction limit/i],
      ["daily_budget_exceeded", /daily budget/i],
      ["category_not_allowed", /isn't allowed to spend/i],
      ["key_revoked", /revoked/i],
      ["key_expired", /expired/i],
      ["key_not_owned", /different account/i],
      ["asset_not_priceable", /can't be priced/i],
    ];
    for (const [reason, expected] of cases) {
      refuseAt(
        "/mpc/sign",
        new ApiError(403, "forbidden", { error: "policy_denied", detail: reason })
      );
      const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
      await expect(signer.signTransaction(TX)).rejects.toThrow(expected);
    }
  });

  it("says nothing was signed when the budget counter is down", async () => {
    // The server fails CLOSED here. The copy must not imply a limit was hit —
    // it must say the check itself was unavailable.
    refuseAt(
      "/mpc/sign",
      new ApiError(403, "forbidden", {
        error: "policy_denied",
        detail: "budget_counter_unavailable",
      })
    );
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/nothing was signed/i);
  });

  it("reports an expired authorization as retryable", async () => {
    refuseAt(
      "/mpc/sign",
      new ApiError(409, "conflict", {
        error: "authorization_expired",
        detail: "This authorization has expired. Start the transaction again.",
      })
    );
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/start the transaction again/i);
  });

  it("surfaces a prepare refusal as a mismatch, not a policy denial", async () => {
    // The server decoded the calldata and it disagreed with our description.
    // That is a client bug and it is safe to say so — the caller supplied
    // every value involved.
    refuseAt(
      "/transactions/prepare",
      new ApiError(400, "bad request", {
        error: "proposal_refused",
        reasons: ["payload_amount_mismatch"],
      })
    );
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/did not match what the app described/i);
  });

  it("reports an unauthorized device without pretending it is a policy limit", async () => {
    refuseAt(
      "/transactions/prepare",
      new ApiError(403, "forbidden", { error: "device_not_authorized", detail: "device_not_authorized" })
    );
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/isn't authorised to sign/i);
  });

  it("distinguishes 'needs another approval' from a refusal", async () => {
    // Turnkey quorum: a real state, not a failure to retry blindly.
    refuseAt("/mpc/sign", new ApiError(202, "pending", { detail: "awaiting" }));
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toBeInstanceOf(MpcSignRefused);
    await expect(signer.signTransaction(TX)).rejects.toThrow(/another approval/i);
  });

  it("reports an unconfigured deployment as unavailable, not denied", async () => {
    refuseAt("/mpc/sign", new ApiError(503, "unavailable", { error: "mpc_unavailable" }));
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/isn't available/i);
  });
});

describe("client-side policy still applies over the remote backend", () => {
  it("never reaches the network for an out-of-policy transaction", async () => {
    healthyServer();
    const signer = new MpcSigner(new RemoteMpcBackend({ signWith: ADDRESS }), {
      allowedChainIds: [8453],
    });
    await expect(signer.signTransaction(TX)).rejects.toThrow(/isn't authorised/i);
    // Two independent gates: the client declines to ask at all.
    expect(api).not.toHaveBeenCalled();
  });
});
