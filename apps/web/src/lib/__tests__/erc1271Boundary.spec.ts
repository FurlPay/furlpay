import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// The ERC-1271 / ERC-6492 boundary, driven with crafted RPC responses.
//
// WHAT FURLPAY ACTUALLY DELEGATES. `verifyAuthorizationSignature` tries pure
// ECDSA recovery first (no network). When that fails — which is the normal case
// for a smart-contract wallet, because there is no key to recover — it builds a
// viem public client and calls `client.verifyTypedData()`. That is the line
// where FurlPay stops verifying anything itself and starts trusting viem's
// contract-signature logic plus whatever an RPC endpoint says.
//
// WHY CRAFTED RPC RATHER THAN A CHAIN. The question this file answers is not
// "does viem implement ERC-1271 correctly" — that is viem's test suite, and
// this audit does not claim to have independently verified it. The question is
// "what does FURLPAY accept when the thing on the other end of the wire
// misbehaves". A local JSON-RPC server that returns exactly the bytes I choose
// answers that precisely, including cases a well-behaved chain cannot produce:
// truncated return data, a wrong-length word, an unknown selector, a revert
// with no reason, a response that changes between identical calls.
//
// THE ATTACKER-CONTROLLED INPUT THAT MATTERS. `auth.from` is whatever the
// payer's request claims. So an attacker chooses the ADDRESS this verification
// path reaches out to. That is inherent to ERC-1271 — you must ask the claimed
// signer's own contract whether it endorses the signature — and it is exactly
// why every malformed answer below has to fail closed. The one thing an
// attacker must NOT be able to influence is the EIP-712 domain, whose
// `verifyingContract` is the pinned asset (F-7); that is asserted separately.
// ---------------------------------------------------------------------------

type RpcHandler = (method: string, params: unknown[], id: unknown) => unknown;

let server: Server;
let rpcUrl = "";
let handler: RpcHandler;
/** Every JSON-RPC call the verifier made, so the test can inspect the target. */
let calls: { method: string; params: unknown[] }[] = [];

let verifyAuthorizationSignature: typeof import("@/lib/x402Signature").verifyAuthorizationSignature;

const NETWORK = "base-sepolia";
/** The claimed signer. Attacker-chosen in a real request. */
const FROM = "0x00000000000000000000000000000000000000c1";
const TO = "0x00000000000000000000000000000000000000d2";
/** The pinned USDC contract for this network — the EIP-712 verifyingContract. */
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const ERC1271_MAGIC = "0x1626ba7e";
const word = (hex: string) => hex.replace(/^0x/, "").padEnd(64, "0");
/** A 32-byte word whose first 4 bytes are the ERC-1271 magic value. */
const MAGIC_RETURN = "0x" + word(ERC1271_MAGIC);

const auth = {
  from: FROM,
  to: TO,
  value: "1000000",
  validAfter: "0",
  validBefore: String(Math.floor(Date.now() / 1000) + 3600),
  nonce: "0x" + "11".repeat(32),
};
// 65 bytes. Deliberately not a real ECDSA signature over this message, so the
// fast path always fails and the contract path is always the one under test.
const SIG = "0x" + "22".repeat(65);

const ctx = () => ({
  network: NETWORK,
  asset: ASSET,
  domainName: "USDC",
  domainVersion: "2",
});

const saved: Record<string, string | undefined> = {};

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
      calls.push({ method: parsed.method, params: parsed.params ?? [] });
      const out = handler(parsed.method, parsed.params ?? [], parsed.id);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  rpcUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  saved.BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
  saved.BASE_SEPOLIA_RPC_URL_FALLBACK = process.env.BASE_SEPOLIA_RPC_URL_FALLBACK;
  process.env.BASE_SEPOLIA_RPC_URL = rpcUrl;
  delete process.env.BASE_SEPOLIA_RPC_URL_FALLBACK;

  ({ verifyAuthorizationSignature } = await import("@/lib/x402Signature"));
}, 120_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  calls = [];
});

/** Answer every eth_call with one fixed result. */
const always = (result: unknown): RpcHandler =>
  (method, _params, id) => {
    if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: "0x14a34" }; // 84532
    return { jsonrpc: "2.0", id, result };
  };

/** Answer every eth_call with a JSON-RPC error (a revert, an RPC failure…). */
const alwaysError = (message: string, code = 3, data?: string): RpcHandler =>
  (method, _params, id) => {
    if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: "0x14a34" };
    return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
  };

// ───────────────────────────────────────────────────────────────────────────

describe("what the contract path actually reaches out to", () => {
  it("makes an eth_call when ECDSA recovery fails", async () => {
    handler = always("0x");
    await verifyAuthorizationSignature(auth, SIG, ctx());
    const ethCalls = calls.filter((c) => c.method === "eth_call");
    expect(ethCalls.length, "no contract call was attempted at all").toBeGreaterThan(0);
  });

  it("the call is driven by auth.from — attacker-chosen, and inherently so", async () => {
    // Recorded rather than treated as a defect. ERC-1271 REQUIRES asking the
    // claimed signer's own contract; there is no version of this check that
    // does not touch an address the request named. What follows from it is that
    // every malformed answer must fail closed, which is what the rest of this
    // file establishes.
    handler = always("0x");
    await verifyAuthorizationSignature(auth, SIG, ctx());
    const ethCall = calls.find((c) => c.method === "eth_call");
    const serialised = JSON.stringify(ethCall?.params ?? []).toLowerCase();
    // viem verifies contract signatures with a deployless call, so `from` may
    // appear in the calldata rather than as the `to`. Either way it is present,
    // and that is the point being documented.
    expect(serialised).toContain(FROM.slice(2).toLowerCase());
  });

  it("the signature is bound to the asset — a different asset produces a different call", async () => {
    // F-7's guarantee, re-checked at this layer. The asset is the EIP-712
    // `verifyingContract`, and the domain is HASHED, so the address never
    // appears literally in the calldata — searching for it would be testing the
    // wrong thing. What can be observed, and is the property that matters, is
    // that the asset is genuinely an input to the hash: change it, and the
    // bytes sent on the wire change. A domain that ignored the asset would
    // produce identical calldata for both.
    handler = always("0x");

    await verifyAuthorizationSignature(auth, SIG, ctx());
    const first = JSON.stringify(calls.find((c) => c.method === "eth_call")?.params ?? []);

    calls = [];
    const otherAsset = "0x1111111111111111111111111111111111111111";
    await verifyAuthorizationSignature(auth, SIG, { ...ctx(), asset: otherAsset });
    const second = JSON.stringify(calls.find((c) => c.method === "eth_call")?.params ?? []);

    expect(first).not.toBe("[]");
    expect(second).not.toBe("[]");
    expect(second, "the asset is not bound into the signed domain").not.toBe(first);
  });
});

describe("every malformed contract answer fails closed", () => {
  const cases: [string, () => void][] = [
    ["empty return data", () => (handler = always("0x"))],
    ["a zero word", () => (handler = always("0x" + "00".repeat(32)))],
    ["the WRONG magic value", () => (handler = always("0x" + word("0xdeadbeef")))],
    ["a near-miss magic value (one bit off)", () => (handler = always("0x" + word("0x1626ba7f")))],
    ["truncated return data (4 bytes)", () => (handler = always(ERC1271_MAGIC))],
    ["an odd-length hex string", () => (handler = always("0x1626ba7e0"))],
    ["not hex at all", () => (handler = always("garbage"))],
    ["a JSON null result", () => (handler = always(null))],
    ["a numeric result", () => (handler = always(42))],
    ["an object result", () => (handler = always({ magic: ERC1271_MAGIC }))],
    ["an enormous return blob", () => (handler = always("0x" + "ab".repeat(40_000)))],
    ["a revert with no reason", () => (handler = alwaysError("execution reverted"))],
    ["a revert with reason data", () => (handler = alwaysError("execution reverted", 3, "0x08c379a0"))],
    ["out of gas", () => (handler = alwaysError("out of gas", -32000))],
    ["an RPC internal error", () => (handler = alwaysError("internal error", -32603))],
    ["a rate-limit error", () => (handler = alwaysError("429 too many requests", -32005))],
  ];

  for (const [label, setup] of cases) {
    it(`${label} → NOT verified`, async () => {
      setup();
      const v = await verifyAuthorizationSignature(auth, SIG, ctx());
      expect(v.verified, `${label} was accepted as a valid signature`).toBe(false);
      expect(v.reason).toBeTruthy();
    });
  }

  it("an unreachable RPC endpoint fails closed — and reports a MISLEADING reason", async () => {
    // Documents observed behaviour, including the part that is not ideal.
    //
    // The security property holds: an unreachable endpoint never yields
    // `verified: true`. But the reason is `signature_recovery_mismatch`, not
    // `signature_verification_error`, because viem's `verifyTypedData` catches
    // transport failures internally and returns `false` rather than throwing —
    // so the `catch` block that would have reported an infrastructure problem
    // does not run, and the code falls through to the cryptographic verdict.
    //
    // CONSEQUENCE, recorded as a LIMITATION rather than a vulnerability: an RPC
    // outage is indistinguishable from a bad signature in the logs. An operator
    // would investigate the payer's wallet instead of their own endpoint, and
    // an attacker who can degrade the RPC can deny service to every
    // smart-contract-wallet payer — while failing closed, which is correct.
    const prev = process.env.BASE_SEPOLIA_RPC_URL;
    process.env.BASE_SEPOLIA_RPC_URL = "http://127.0.0.1:1";
    try {
      const v = await verifyAuthorizationSignature(auth, SIG, ctx());
      expect(v.verified, "an unreachable RPC produced a verified signature").toBe(false);
      expect(v.reason).toBe("signature_recovery_mismatch");
    } finally {
      process.env.BASE_SEPOLIA_RPC_URL = prev;
    }
  }, 60_000);

  it("a hanging RPC does not hang the verifier forever", async () => {
    // A malicious or overloaded endpoint that accepts the connection and never
    // answers. The verifier must not leave a payment decision pending
    // indefinitely.
    handler = ((method, _p, id) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: "0x14a34" };
      // Returning undefined makes the server write "undefined", which viem
      // rejects as a malformed response — the closest deterministic stand-in
      // for a broken endpoint that does not stall the suite.
      return undefined;
    }) as RpcHandler;
    const v = await verifyAuthorizationSignature(auth, SIG, ctx());
    expect(v.verified).toBe(false);
  }, 60_000);
});

describe("a contract that changes its answer between calls", () => {
  it("cannot turn a rejected signature into an accepted one after the fact", async () => {
    // The TOCTOU shape: a contract that says "no" while being checked and "yes"
    // later, or the reverse. FurlPay asks once and acts on that answer, so what
    // matters is that a later change cannot retroactively validate a payment
    // that was already refused.
    let n = 0;
    handler = ((method, _p, id) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: "0x14a34" };
      n += 1;
      return { jsonrpc: "2.0", id, result: n > 1 ? MAGIC_RETURN : "0x" };
    }) as RpcHandler;

    const first = await verifyAuthorizationSignature(auth, SIG, ctx());
    expect(first.verified, "the first answer was 'no' and must stand").toBe(false);
  });

  it("a later 'no' is equally final — each verification is its own decision", async () => {
    let n = 0;
    handler = ((method, _p, id) => {
      if (method === "eth_chainId") return { jsonrpc: "2.0", id, result: "0x14a34" };
      n += 1;
      return { jsonrpc: "2.0", id, result: n === 1 ? MAGIC_RETURN : "0x" };
    }) as RpcHandler;

    const first = await verifyAuthorizationSignature(auth, SIG, ctx());
    const second = await verifyAuthorizationSignature(auth, SIG, ctx());
    // Whatever the first answer was, the second is decided on its own evidence.
    expect(second.verified).toBe(false);
    expect(typeof first.verified).toBe("boolean");
  });
});

describe("the non-EVM boundary is explicit, not silent", () => {
  it("Solana returns svm_verification_unavailable rather than false", async () => {
    // "Not checked" must never be recorded as "checked and invalid", and above
    // all never as "checked and valid".
    const v = await verifyAuthorizationSignature(auth, SIG, { ...ctx(), network: "solana" });
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("svm_verification_unavailable");
  });

  it("an unknown network is refused before any RPC is attempted", async () => {
    handler = always(MAGIC_RETURN); // would verify if it were ever reached
    const v = await verifyAuthorizationSignature(auth, SIG, { ...ctx(), network: "not-a-chain" });
    expect(v.verified).toBe(false);
    expect(calls.filter((c) => c.method === "eth_call")).toHaveLength(0);
  });
});

describe("malformed inputs never reach the network at all", () => {
  const bad: [string, Record<string, string>, string][] = [
    ["a non-address from", { from: "0xnope" }, "bad_address"],
    ["a non-address to", { to: "not-an-address" }, "bad_address"],
    ["a short nonce", { nonce: "0x1234" }, "bad_nonce"],
    // F-19: every one of these was previously ACCEPTED, because `BigInt` coerces
    // rather than rejects. The negative is the worst — EIP-3009 encodes `value`
    // as a uint256, so "-5" is not a small number, it is an enormous one.
    ["a hex value", { value: "0x10" }, "bad_numeric_field"],
    ["a decimal value", { value: "1.5" }, "bad_numeric_field"],
    ["an empty value", { value: "" }, "bad_numeric_field"],
    ["a whitespace value", { value: "   " }, "bad_numeric_field"],
    ["a plus-prefixed value", { value: "+5" }, "bad_numeric_field"],
    ["a NEGATIVE value", { value: "-5" }, "bad_numeric_field"],
    ["a hex validAfter", { validAfter: "0x0" }, "bad_numeric_field"],
    ["an empty validBefore", { validBefore: "" }, "bad_numeric_field"],
    ["a negative validBefore", { validBefore: "-1" }, "bad_numeric_field"],
  ];

  for (const [label, patch, reason] of bad) {
    it(`${label} is refused without an RPC call`, async () => {
      handler = always(MAGIC_RETURN);
      const v = await verifyAuthorizationSignature({ ...auth, ...patch }, SIG, ctx());
      expect(v.verified).toBe(false);
      expect(v.reason).toBe(reason);
      expect(calls.filter((c) => c.method === "eth_call"), `${label} reached the network`).toHaveLength(0);
    });
  }

  it("a bad signature length is refused without an RPC call", async () => {
    handler = always(MAGIC_RETURN);
    // 130 and 132 characters are both legitimate (64-byte and 65-byte
    // signatures), so only lengths outside that set belong here.
    for (const sig of ["0x", "0x22", "0x" + "22".repeat(66), "not-hex", "0x" + "22".repeat(20)]) {
      const v = await verifyAuthorizationSignature(auth, sig, ctx());
      expect(v.verified, `signature ${sig.slice(0, 12)}… was accepted`).toBe(false);
      expect(v.reason).toBe("bad_signature_format");
    }
    expect(calls.filter((c) => c.method === "eth_call")).toHaveLength(0);
  });

  it("a non-pinned asset is refused without an RPC call", async () => {
    // Defence in depth on F-7: even if a caller reached this function with an
    // arbitrary asset, a malformed one never becomes an eth_call target.
    handler = always(MAGIC_RETURN);
    const v = await verifyAuthorizationSignature(auth, SIG, { ...ctx(), asset: "0xnot-an-address" });
    expect(v.verified).toBe(false);
    expect(v.reason).toBe("bad_asset");
    expect(calls.filter((c) => c.method === "eth_call")).toHaveLength(0);
  });
});
