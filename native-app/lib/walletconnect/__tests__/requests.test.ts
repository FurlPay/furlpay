import { decodeRequest, hexToUtf8, looksLikePermit, utf8ToHex } from "../requests";
import type { SessionRequest } from "../types";

// The decoder feeds the confirmation sheet. Anything it gets wrong is something
// the user is shown incorrectly and then signs, so these tests concentrate on
// hostile and malformed input rather than on well-behaved dApps.

const ADDR = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function req(over: Partial<SessionRequest> = {}): SessionRequest {
  return {
    id: 1,
    topic: "t",
    chainId: "eip155:1",
    method: "eth_sendTransaction",
    params: [],
    receivedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...over,
  };
}

describe("decodeRequest — transactions", () => {
  it("decodes a transaction with hex quantities exactly", () => {
    const res = decodeRequest(
      req({ params: [{ from: ADDR, to: OTHER, value: "0xde0b6b3a7640000", data: "0x" }] }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok || res.intent.kind !== "transaction") return;
    // 1e18 exceeds 2^53; parsing as a JS number would round it and the user
    // would be shown an amount they did not agree to.
    expect(res.intent.value).toBe(1_000_000_000_000_000_000n);
    expect(res.intent.broadcast).toBe(true);
  });

  it("accepts decimal quantities, which real dApps send", () => {
    const res = decodeRequest(req({ params: [{ from: ADDR, to: OTHER, value: "1000", data: "0x" }] }));
    expect(res.ok && res.intent.kind === "transaction" && res.intent.value).toBe(1000n);
  });

  it("treats a missing value as zero", () => {
    const res = decodeRequest(req({ params: [{ from: ADDR, to: OTHER, data: "0x" }] }));
    expect(res.ok && res.intent.kind === "transaction" && res.intent.value).toBe(0n);
  });

  it("distinguishes eth_signTransaction from eth_sendTransaction", () => {
    const res = decodeRequest(
      req({ method: "eth_signTransaction", params: [{ from: ADDR, to: OTHER, data: "0x" }] }),
    );
    expect(res.ok && res.intent.kind === "transaction" && res.intent.broadcast).toBe(false);
  });

  it("reads the `input` alias some dApps use for calldata", () => {
    const res = decodeRequest(req({ params: [{ from: ADDR, to: OTHER, input: "0xabcd" }] }));
    expect(res.ok && res.intent.kind === "transaction" && res.intent.data).toBe("0xabcd");
  });

  // Contract creation cannot be rendered honestly — the app cannot tell a user
  // what bytecode does — so it is refused rather than shown as a blank screen.
  it("refuses contract creation", () => {
    const res = decodeRequest(req({ params: [{ from: ADDR, value: "0x0", data: "0x6080" }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message).toMatch(/deployment/i);
  });

  it("refuses an invalid recipient", () => {
    const res = decodeRequest(req({ params: [{ from: ADDR, to: "0xnope", data: "0x" }] }));
    expect(res.ok).toBe(false);
  });

  it("refuses a missing sender", () => {
    expect(decodeRequest(req({ params: [{ to: OTHER, data: "0x" }] })).ok).toBe(false);
  });

  it("refuses non-hex calldata", () => {
    expect(decodeRequest(req({ params: [{ from: ADDR, to: OTHER, data: "hello" }] })).ok).toBe(false);
  });

  // Silently ignoring a bad gas hint would overrule a dApp that had a reason
  // for the number it sent.
  it("refuses a malformed gas hint rather than ignoring it", () => {
    const res = decodeRequest(req({ params: [{ from: ADDR, to: OTHER, data: "0x", gas: "banana" }] }));
    expect(res.ok).toBe(false);
  });

  it("survives entirely absent params", () => {
    expect(decodeRequest(req({ params: [] })).ok).toBe(false);
    expect(decodeRequest(req({ params: null as unknown as unknown[] })).ok).toBe(false);
  });

  it("rejects an unsupported chain namespace", () => {
    const res = decodeRequest(req({ chainId: "solana:mainnet" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe(5100);
  });
});

describe("decodeRequest — personal_sign", () => {
  // Wallets have shipped this argument order backwards repeatedly; both are
  // accepted by detecting which element is an address.
  it("accepts [message, address], the spec order", () => {
    const res = decodeRequest(req({ method: "personal_sign", params: [utf8ToHex("hello"), ADDR] }));
    expect(res.ok).toBe(true);
    if (!res.ok || res.intent.kind !== "personal_sign") return;
    expect(res.intent.address).toBe(ADDR);
    expect(res.intent.messageText).toBe("hello");
  });

  it("accepts [address, message], which many dApps send", () => {
    const res = decodeRequest(req({ method: "personal_sign", params: [ADDR, utf8ToHex("hello")] }));
    expect(res.ok && res.intent.kind === "personal_sign" && res.intent.messageText).toBe("hello");
  });

  it("accepts a plain-text message that is not hex", () => {
    const res = decodeRequest(req({ method: "personal_sign", params: ["Sign in to example.com", ADDR] }));
    expect(res.ok && res.intent.kind === "personal_sign" && res.intent.messageText).toBe("Sign in to example.com");
  });

  // The load-bearing case: binary that decodes to control characters must NOT
  // be rendered as text, because a lossy rendering is how a user reads
  // something other than what they sign.
  it("leaves messageText undefined for non-printable bytes", () => {
    const res = decodeRequest(req({ method: "personal_sign", params: ["0x0001020304", ADDR] }));
    expect(res.ok).toBe(true);
    if (!res.ok || res.intent.kind !== "personal_sign") return;
    expect(res.intent.messageText).toBeUndefined();
    expect(res.intent.messageHex).toBe("0x0001020304");
  });

  it("refuses a request with no address anywhere", () => {
    expect(decodeRequest(req({ method: "personal_sign", params: ["0xdead", "0xbeef"] })).ok).toBe(false);
  });
});

describe("decodeRequest — typed data", () => {
  const payload = {
    domain: { name: "Test", chainId: 1 },
    primaryType: "Mail",
    types: { Mail: [{ name: "contents", type: "string" }] },
    message: { contents: "hi" },
  };

  it("decodes an object payload", () => {
    const res = decodeRequest(req({ method: "eth_signTypedData_v4", params: [ADDR, payload] }));
    expect(res.ok && res.intent.kind === "typed_data" && res.intent.primaryType).toBe("Mail");
  });

  it("decodes a JSON-string payload, which is the common wire form", () => {
    const res = decodeRequest(req({ method: "eth_signTypedData_v4", params: [ADDR, JSON.stringify(payload)] }));
    expect(res.ok && res.intent.kind === "typed_data" && res.intent.primaryType).toBe("Mail");
  });

  it("refuses a payload that is not valid JSON", () => {
    expect(decodeRequest(req({ method: "eth_signTypedData_v4", params: [ADDR, "{oops"] })).ok).toBe(false);
  });

  it("refuses a payload with no primaryType", () => {
    const res = decodeRequest(req({ method: "eth_signTypedData_v4", params: [ADDR, { domain: {}, message: {} }] }));
    expect(res.ok).toBe(false);
  });

  it("flags a Permit as a spending approval", () => {
    const permit = { ...payload, primaryType: "Permit", message: { spender: OTHER, value: "1000" } };
    const res = decodeRequest(req({ method: "eth_signTypedData_v4", params: [ADDR, permit] }));
    expect(res.ok && res.intent.kind === "typed_data" && res.intent.isPermit).toBe(true);
  });
});

describe("looksLikePermit", () => {
  it("matches on the name", () => {
    expect(looksLikePermit("PermitSingle", {})).toBe(true);
  });

  // A drainer will not call its type "Permit". Shape matching is what catches
  // the ones that do not announce themselves.
  it("matches on shape regardless of the type name", () => {
    expect(looksLikePermit("Order", { spender: "0x1", amount: "1" })).toBe(true);
    expect(looksLikePermit("Whatever", { operator: "0x1", tokenId: "3" })).toBe(true);
  });

  it("does not flag an ordinary message", () => {
    expect(looksLikePermit("Mail", { contents: "hi", from: "0x1" })).toBe(false);
  });
});

describe("hex/utf8 round trips", () => {
  it("round-trips ASCII, accents and emoji", () => {
    for (const s of ["hello", "Grüße", "日本語", "gm 🌅", "tabs\tand\nnewlines"]) {
      expect(hexToUtf8(utf8ToHex(s))).toBe(s);
    }
  });

  it("returns undefined for malformed or truncated UTF-8", () => {
    expect(hexToUtf8("0xff")).toBeUndefined();
    expect(hexToUtf8("0xc3")).toBeUndefined(); // truncated 2-byte sequence
    expect(hexToUtf8("0xabc")).toBeUndefined(); // odd length
    expect(hexToUtf8("nothex")).toBeUndefined();
  });
});
