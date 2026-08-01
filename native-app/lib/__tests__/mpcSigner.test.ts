import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "../evm/rlp";
import { signingHash, type Eip1559Transaction } from "../evm/transaction";
import {
  MpcPolicyDenied,
  MpcSigner,
  parseCompactSignature,
  recoverAddress,
  type MpcBackend,
  type MpcSignRequest,
} from "../signing/mpcSigner";
import { requireOwnConfirmation, supportsChain, type AccountSigner } from "../signing/types";

// ---------------------------------------------------------------------------
// The MPC signer, and specifically the three properties that make a remote
// signing share safe to depend on:
//
//   1. WE assemble the transaction — the backend returns (r, s, yParity) and
//      never a serialized transaction, so it cannot substitute one.
//   2. WE verify recovery — a signature from the wrong key, or over different
//      bytes, is caught here rather than on-chain.
//   3. WE gate locally — an out-of-policy signature is never even requested.
//
// A real backend (Turnkey/Privy/Lit) is a few dozen lines implementing
// `MpcBackend`. None of it is exercised here, because none of it is where the
// security lives.
// ---------------------------------------------------------------------------

/** A deterministic throwaway key standing in for a remote share. */
const PRIV = hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe512961708279f1f4e0a1f2f9c0e2b1");
const ADDRESS = addressOf(PRIV);

/** A different key — an "impostor" backend signing with the wrong share. */
const OTHER_PRIV = hexToBytes(
  "0x8da4ef21b864d2cc526dbdb2a120bd2874c36c9d0a1fb7f8c63d7f7a8b4c1e9f"
);

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

function backend(overrides: Partial<MpcBackend> = {}, key = PRIV): MpcBackend & { calls: number } {
  const impl = {
    label: "Turnkey",
    calls: 0,
    getAddress: async () => ADDRESS,
    requestSignature: async (request: MpcSignRequest) => {
      impl.calls++;
      const sig = secp256k1.sign(request.digest, key);
      return { r: sig.r, s: sig.s, yParity: sig.recovery };
    },
    ...overrides,
  };
  return impl as MpcBackend & { calls: number };
}

describe("a valid co-signature", () => {
  it("assembles a broadcastable transaction from the backend's parts", async () => {
    const signer = new MpcSigner(backend());
    const signed = await signer.signTransaction(TX);

    expect(signed.from.toLowerCase()).toBe(ADDRESS.toLowerCase());
    expect(signed.raw.startsWith("0x02")).toBe(true); // EIP-1559 envelope
    expect(signed.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("passes the backend a digest, never a transaction to serialize", async () => {
    let seen: MpcSignRequest | null = null;
    const signer = new MpcSigner(
      backend({
        requestSignature: async (request) => {
          seen = request;
          const sig = secp256k1.sign(request.digest, PRIV);
          return { r: sig.r, s: sig.s, yParity: sig.recovery };
        },
      })
    );
    await signer.signTransaction(TX);

    // The digest must be OURS, computed from the transaction we built.
    expect(bytesToHex(seen!.digest)).toBe(bytesToHex(signingHash(TX)));
    // The transaction travels too, so a backend can apply its own policy —
    // but it is context, not the thing that gets signed back.
    expect(seen!.transaction.chainId).toBe(42161);
  });
});

describe("a backend that misbehaves", () => {
  it("rejects a signature produced by a different key", async () => {
    // The case that matters: a compromised or misconfigured backend signing
    // with a share that is not the user's. On-chain this would send funds from
    // an account nobody expected.
    const signer = new MpcSigner(backend({}, OTHER_PRIV));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/unexpected key/i);
  });

  it("rejects a signature over different bytes", async () => {
    const signer = new MpcSigner(
      backend({
        requestSignature: async () => {
          // Signs a digest of its own choosing rather than the one supplied.
          const sig = secp256k1.sign(keccak_256(new Uint8Array([1, 2, 3])), PRIV);
          return { r: sig.r, s: sig.s, yParity: sig.recovery };
        },
      })
    );
    await expect(signer.signTransaction(TX)).rejects.toThrow(/unexpected key/i);
  });

  it("rejects a malformed parity rather than serializing it", async () => {
    const signer = new MpcSigner(
      backend({
        requestSignature: async (request) => {
          const sig = secp256k1.sign(request.digest, PRIV);
          // A legacy v where EIP-1559 wants parity.
          return { r: sig.r, s: sig.s, yParity: 27 };
        },
      })
    );
    await expect(signer.signTransaction(TX)).rejects.toThrow(/malformed signature/i);
  });

  it("refuses when there is no active session", async () => {
    const signer = new MpcSigner(backend({ getAddress: async () => null }));
    await expect(signer.signTransaction(TX)).rejects.toThrow(/no active signing session/i);
  });
});

describe("local policy, enforced before the network", () => {
  it("refuses a chain the key isn't authorised for", async () => {
    const b = backend();
    const signer = new MpcSigner(b, { allowedChainIds: [8453] }); // Base only

    await expect(signer.signTransaction(TX)).rejects.toBeInstanceOf(MpcPolicyDenied);
    // Never asked. A client that doesn't request an out-of-policy signature
    // cannot be tricked into requesting one, and nothing leaves the device.
    expect(b.calls).toBe(0);
  });

  it("refuses a value above the per-transaction cap", async () => {
    const b = backend();
    const signer = new MpcSigner(b, { perTxMaxWei: 1000n });

    await expect(
      signer.signTransaction({ ...TX, value: 5000n })
    ).rejects.toMatchObject({ reason: "amount_over_limit" });
    expect(b.calls).toBe(0);
  });

  it("enforces a target allowlist, case-insensitively", async () => {
    const b = backend();
    const signer = new MpcSigner(b, { allowedTargets: [TX.to.toUpperCase()] });

    // The allowlisted router, differently cased — same address.
    await expect(signer.signTransaction(TX)).resolves.toBeDefined();

    await expect(
      signer.signTransaction({ ...TX, to: "0x2222222222222222222222222222222222222222" })
    ).rejects.toMatchObject({ reason: "target_not_allowed" });
  });

  it("allows anything when no policy is set", async () => {
    const signer = new MpcSigner(backend());
    await expect(signer.signTransaction({ ...TX, value: 10n ** 18n })).resolves.toBeDefined();
  });
});

describe("capabilities are honest", () => {
  it("does not claim a trusted display it does not have", () => {
    const signer = new MpcSigner(backend());
    const caps = signer.capabilities();

    // The phone renders the confirmation — same posture as the device key, and
    // the app must show the full transaction.
    expect(caps.trustedDisplay).toBe(false);
    expect(requireOwnConfirmation(signer)).toBe(true);
    // But unlike a card handed a bare hash, we serialized what is being signed
    // and can render it.
    expect(caps.prehashedOnly).toBe(false);
  });

  it("has no device connection to manage", () => {
    // An MPC share is reached over HTTPS during signing. Declaring an empty
    // connection would make the UI show a "Connect" button for something
    // already available.
    //
    // Checked through the INTERFACE, which is where `connection` is declared
    // optional and where every consumer sees it.
    const signer: AccountSigner = new MpcSigner(backend());
    expect(signer.connection).toBeUndefined();
  });

  it("reports its chain restriction through the standard capability", () => {
    const restricted = new MpcSigner(backend(), { allowedChainIds: [1, 8453] });
    expect(supportsChain(restricted, 8453)).toBe(true);
    expect(supportsChain(restricted, 42161)).toBe(false);
    // Unrestricted keys are "all", like a software key.
    expect(supportsChain(new MpcSigner(backend()), 42161)).toBe(true);
  });
});

describe("signature parsing", () => {
  it("accepts both 0/1 and 27/28 conventions", () => {
    const r = "1".repeat(64);
    const s = "2".repeat(64);
    expect(parseCompactSignature(`0x${r}${s}00`)?.yParity).toBe(0);
    expect(parseCompactSignature(`0x${r}${s}01`)?.yParity).toBe(1);
    // Backends variously return either; neither is wrong.
    expect(parseCompactSignature(`0x${r}${s}1b`)?.yParity).toBe(0); // 27
    expect(parseCompactSignature(`0x${r}${s}1c`)?.yParity).toBe(1); // 28
  });

  it("returns null for a wrong-length or nonsense v", () => {
    expect(parseCompactSignature("0xabcd")).toBeNull();
    expect(parseCompactSignature("0x" + "1".repeat(128) + "ff")).toBeNull();
  });
});

describe("recoverAddress", () => {
  it("round-trips a real signature", () => {
    const digest = signingHash(TX);
    const sig = secp256k1.sign(digest, PRIV);
    const recovered = recoverAddress(digest, { r: sig.r, s: sig.s, yParity: sig.recovery });
    expect(recovered?.toLowerCase()).toBe(ADDRESS.toLowerCase());
  });

  it("returns null rather than throwing on garbage", () => {
    expect(recoverAddress(signingHash(TX), { r: 0n, s: 0n, yParity: 0 })).toBeNull();
  });
});

function addressOf(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false);
  return bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}
