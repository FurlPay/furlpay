import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "../evm/rlp";
import {
  fromTransactionRequest,
  maximumCostWei,
  serializeSigned,
  signingHash,
  transactionHash,
  type Eip1559Transaction,
} from "../evm/transaction";

// ---------------------------------------------------------------------------
// EIP-1559 serialization.
//
// The expected bytes in `serializes exactly as the spec prescribes` were
// derived BY HAND from EIP-1559 + the RLP rules, not captured from this
// implementation. A snapshot of current output would pass just as happily with
// the fee fields transposed, which is the bug this file exists to prevent:
// swapping maxPriorityFeePerGas and maxFeePerGas yields a perfectly valid
// transaction that pays the tip as the cap. Nothing rejects it. It just costs
// the wrong amount, forever, silently.
// ---------------------------------------------------------------------------

const ADDRESS = "0x1111111111111111111111111111111111111111";

const SIMPLE: Eip1559Transaction = {
  chainId: 1,
  nonce: 0n,
  maxPriorityFeePerGas: 1n,
  maxFeePerGas: 2n,
  gasLimit: 21000n,
  to: ADDRESS,
  value: 0n,
  data: "0x",
};

describe("EIP-1559 serialization", () => {
  it("serializes exactly as the spec prescribes", () => {
    // Derivation, field by field:
    //   0x02                         type envelope
    //   0xdf                         list, payload = 31 bytes (0xc0 + 31)
    //   0x01                         chainId 1        (single byte < 0x80)
    //   0x80                         nonce 0          (zero = EMPTY string)
    //   0x01                         maxPriorityFeePerGas 1   <- tip FIRST
    //   0x02                         maxFeePerGas 2           <- cap SECOND
    //   0x825208                     gasLimit 21000 = 0x5208
    //   0x94 ‖ 20 bytes              to (0x80 + 20 = 0x94)
    //   0x80                         value 0
    //   0x80                         data "" (empty)
    //   0xc0                         accessList [] (empty LIST, not 0x80)
    const expected =
      "0x02df01800102825208941111111111111111111111111111111111111111" + "8080c0";

    const encoded = bytesToHex(
      // signingHash keccaks the envelope, so rebuild it here to assert the
      // pre-hash bytes — the hash alone would hide a field-order swap.
      envelopeOf(SIMPLE)
    );
    expect(encoded).toBe(expected);
  });

  it("puts the tip before the cap", () => {
    // The same assertion stated so it cannot be "fixed" by updating a blob.
    const hex = bytesToHex(envelopeOf({ ...SIMPLE, maxPriorityFeePerGas: 0x11n, maxFeePerGas: 0x22n }));
    expect(hex.indexOf("11")).toBeLessThan(hex.indexOf("22"));
  });

  it("encodes an empty access list as a list, not a string", () => {
    // 0xc0 (empty list) vs 0x80 (empty string): one byte, and the difference
    // between a valid transaction and one every node rejects.
    expect(bytesToHex(envelopeOf(SIMPLE)).endsWith("c0")).toBe(true);
  });

  it("rejects a malformed recipient rather than encoding it", () => {
    expect(() => signingHash({ ...SIMPLE, to: "0x1234" })).toThrow(/recipient/i);
    expect(() => signingHash({ ...SIMPLE, to: "" })).toThrow(/recipient/i);
  });

  it("changes the digest when any field changes", () => {
    const base = bytesToHex(signingHash(SIMPLE));
    for (const mutation of [
      { nonce: 1n },
      { chainId: 42161 },
      { value: 1n },
      { gasLimit: 21001n },
      { maxFeePerGas: 3n },
      { data: "0xab" },
      { to: "0x2222222222222222222222222222222222222222" },
    ] as Partial<Eip1559Transaction>[]) {
      expect(bytesToHex(signingHash({ ...SIMPLE, ...mutation }))).not.toBe(base);
    }
  });
});

describe("signing", () => {
  // Deterministic throwaway key. Never used anywhere real.
  const priv = hexToBytes("0x4c0883a69102937d6231471b5dbb6204fe512961708279f1f4e0a1f2f9c0e2b1");
  const address = addressOf(priv);

  it("produces a signature that recovers to the signing address", () => {
    const digest = signingHash(SIMPLE);
    const sig = secp256k1.sign(digest, priv);
    const recovered = addressFromPublicKey(sig.recoverPublicKey(digest).toRawBytes(false));
    expect(recovered).toBe(address);
  });

  it("uses yParity 0/1, never a legacy v", () => {
    const digest = signingHash(SIMPLE);
    const sig = secp256k1.sign(digest, priv);
    expect([0, 1]).toContain(sig.recovery);

    // A legacy v (27/28) reaching serializeSigned would produce a signature
    // that recovers to no address at all, so it is refused outright.
    expect(() => serializeSigned(SIMPLE, { yParity: 27, r: sig.r, s: sig.s })).toThrow(/yParity/);
  });

  it("serializes yParity 0 as the empty string", () => {
    // RLP's minimal-integer rule applies to yParity too: 0 is 0x80, not 0x00.
    const raw = serializeSigned(SIMPLE, { yParity: 0, r: 1n, s: 1n });
    expect(raw).toContain("800101");
  });

  it("gives every distinct transaction a distinct hash", () => {
    const sig = { yParity: 1, r: 12345n, s: 67890n };
    expect(transactionHash(SIMPLE, sig)).not.toBe(
      transactionHash({ ...SIMPLE, nonce: 1n }, sig)
    );
    expect(transactionHash(SIMPLE, sig)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("fromTransactionRequest", () => {
  const request = {
    to: ADDRESS,
    data: "0xdeadbeef",
    value: "0x0",
    chainId: 42161,
    gasLimit: "0x5208",
  };
  const state = {
    nonce: 7n,
    maxFeePerGas: 100n,
    maxPriorityFeePerGas: 1n,
    fallbackGasLimit: 500_000n,
  };

  it("prefers the route's gas estimate", () => {
    expect(fromTransactionRequest(request, state).gasLimit).toBe(21000n);
  });

  it("falls back when the route carried no estimate", () => {
    const { gasLimit } = fromTransactionRequest({ ...request, gasLimit: undefined }, state);
    expect(gasLimit).toBe(500_000n);
  });

  it("reads value as a bigint, not a rounded number", () => {
    // 10^18 wei — beyond Number's exact range once combined with gas maths.
    const big = fromTransactionRequest({ ...request, value: "0xde0b6b3a7640000" }, state);
    expect(big.value).toBe(1_000_000_000_000_000_000n);
  });

  it("treats empty calldata as 0x", () => {
    expect(fromTransactionRequest({ ...request, data: "" }, state).data).toBe("0x");
  });
});

describe("maximumCostWei", () => {
  it("prices the worst case, so a balance check cannot pass optimistically", () => {
    // gasLimit × maxFeePerGas (the CAP, not the expected price) + value.
    const cost = maximumCostWei({ ...SIMPLE, value: 5n, gasLimit: 21000n, maxFeePerGas: 100n });
    expect(cost).toBe(5n + 21000n * 100n);
  });
});

// --- helpers ----------------------------------------------------------------

/** The pre-hash envelope, so tests can assert bytes rather than a digest. */
function envelopeOf(tx: Eip1559Transaction): Uint8Array {
  // Reconstructed from the signed form: strip the signature fields by
  // re-serializing without them is not exposed, so hash-equality is checked via
  // signingHash and the byte layout via this independent rebuild.
  const raw = serializeSigned(tx, { yParity: 0, r: 0n, s: 0n });
  const bytes = hexToBytes(raw);
  // Signed form appends yParity(0x80) r(0x80) s(0x80) — three empty strings —
  // and its list header is 3 bytes longer than the unsigned one.
  const withoutSignature = bytes.slice(0, bytes.length - 3);
  const payloadLength = withoutSignature.length - 2; // minus type byte and header
  const out = new Uint8Array(withoutSignature.length);
  out.set(withoutSignature);
  out[1] = 0xc0 + payloadLength;
  return out;
}

function addressOf(priv: Uint8Array): string {
  return addressFromPublicKey(secp256k1.getPublicKey(priv, false));
}

function addressFromPublicKey(pub: Uint8Array): string {
  return bytesToHex(keccak_256(pub.slice(1)).slice(-20));
}
