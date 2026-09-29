import { describe, it, expect } from "vitest";
import {
  canonicalResource,
  verifyResourceBinding,
  checkClaimConsistency,
  resourceBindingRequired,
  type NonceClaim,
} from "../x402ResourceBinding";
import { verify, type FacilitatorRequest } from "../x402Facilitator";
import { bindingMac, NETWORK_USDC, X402_VERSION } from "../x402";

// ---------------------------------------------------------------------------
// SR1 — resource binding at the facilitator.
//
// THE ATTACK. arXiv:2607.19545 SR1 requires a facilitator to refuse a proof that
// does not match the server-declared requirements. The facilitator checked
// scheme, network, payTo and amount, and never the RESOURCE — the paper's F1,
// cross-resource substitution. The leak is DOUBLE DELIVERY, not double
// settlement:
//
//   /verify burns nothing. One authorization presented to two resource servers
//   with the same price and payee made BOTH serve their content, and only one
//   /settle could then win the single-use nonce. One payment, two resources.
//
// These tests are written as the substituting attacker.
// ---------------------------------------------------------------------------

const PAYER = "0x1111111111111111111111111111111111111111";
const RESOURCE = "https://api.example.com/v1/quote";
const AMOUNT = "1000";

function quoteExtra(over: Partial<{ resource: string; method: string; amount: string; quoteId: string; expiresAt: number }> = {}) {
  const resource = over.resource ?? RESOURCE;
  const method = over.method ?? "GET";
  const amount = over.amount ?? AMOUNT;
  const quoteId = over.quoteId ?? "a".repeat(32);
  const expiresAt = over.expiresAt ?? Math.floor(Date.now() / 1000) + 300;
  return {
    name: "USD Coin",
    version: "2",
    quoteId,
    expiresAt,
    method,
    binding: bindingMac(resource, method, amount, quoteId, expiresAt),
  };
}

/** A request whose quote binding was minted for `boundTo`, presented for `presentedAs`. */
function request(opts: {
  presentedAs?: string;
  boundTo?: string;
  amount?: string;
  boundAmount?: string;
  method?: string;
  boundMethod?: string;
  extra?: unknown;
} = {}): FacilitatorRequest {
  const presentedAs = opts.presentedAs ?? RESOURCE;
  const amount = opts.amount ?? AMOUNT;
  return {
    x402Version: X402_VERSION,
    paymentPayload: {
      x402Version: X402_VERSION,
      scheme: "exact",
      network: "arbitrum",
      payload: {
        signature: "0x" + "ab".repeat(65),
        authorization: {
          from: PAYER,
          to: PAYER,
          value: amount,
          validAfter: "0",
          validBefore: "99999999999",
          nonce: "0x" + "cd".repeat(32),
        },
      },
    },
    paymentRequirements: {
      scheme: "exact",
      network: "arbitrum",
      maxAmountRequired: amount,
      resource: presentedAs,
      description: "",
      mimeType: "application/json",
      payTo: PAYER,
      maxTimeoutSeconds: 300,
      asset: NETWORK_USDC.arbitrum,
      extra: (opts.extra !== undefined
        ? opts.extra
        : quoteExtra({
            resource: opts.boundTo ?? presentedAs,
            amount: opts.boundAmount ?? amount,
            method: opts.boundMethod ?? opts.method ?? "GET",
          })) as never,
    },
  } as FacilitatorRequest;
}

const NOW = Math.floor(Date.now() / 1000);

describe("SR1: a valid exact-resource payment still succeeds", () => {
  it("a correctly bound payment verifies", async () => {
    const r = await verify(request());
    expect(r.isValid).toBe(true);
    expect(r.payer).toBe(PAYER);
  });

  it("an UNBOUND payment is permitted by default and reported as unbound", () => {
    // A third-party resource server cannot mint our HMAC, so an absent binding
    // must not break them — but the result records that nothing tied this
    // payment to the resource.
    const out = verifyResourceBinding({
      resource: RESOURCE,
      amountAtomic: AMOUNT,
      extra: null,
      nowSeconds: NOW,
      require: false,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.bound).toBe(false);
  });

  it("strict mode REQUIRES a binding", () => {
    const out = verifyResourceBinding({
      resource: RESOURCE,
      amountAtomic: AMOUNT,
      extra: null,
      nowSeconds: NOW,
      require: true,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("binding_required");
  });

  it("strict mode is off unless explicitly enabled", () => {
    const prev = process.env.X402_REQUIRE_RESOURCE_BINDING;
    delete process.env.X402_REQUIRE_RESOURCE_BINDING;
    try {
      expect(resourceBindingRequired()).toBe(false);
      process.env.X402_REQUIRE_RESOURCE_BINDING = "1";
      expect(resourceBindingRequired()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.X402_REQUIRE_RESOURCE_BINDING;
      else process.env.X402_REQUIRE_RESOURCE_BINDING = prev;
    }
  });
});

describe("SR1: substitution attacks fail closed", () => {
  // Each case mints the binding for one resource and presents it for another.
  const substitutions: Array<[string, string, string]> = [
    ["different path", RESOURCE, "https://api.example.com/v1/expensive"],
    ["different host", RESOURCE, "https://evil.example.com/v1/quote"],
    ["different subdomain", RESOURCE, "https://api2.example.com/v1/quote"],
    ["different query", RESOURCE, "https://api.example.com/v1/quote?tier=premium"],
    ["query removed", "https://api.example.com/v1/quote?tier=basic", RESOURCE],
    ["different scheme", RESOURCE, "http://api.example.com/v1/quote"],
    ["trailing slash", RESOURCE, "https://api.example.com/v1/quote/"],
    ["path traversal", RESOURCE, "https://api.example.com/v1/../v1/expensive"],
    ["appended segment", RESOURCE, "https://api.example.com/v1/quote/extra"],
    ["different port", RESOURCE, "https://api.example.com:8443/v1/quote"],
    ["percent-encoded slash", "https://api.example.com/a/b", "https://api.example.com/a%2Fb"],
    ["homoglyph host", RESOURCE, "https://api.exampIe.com/v1/quote"],
  ];

  for (const [label, boundTo, presentedAs] of substitutions) {
    it(`REFUSES ${label}`, async () => {
      const r = await verify(request({ boundTo, presentedAs }));
      expect(r.isValid, `${label} must not verify`).toBe(false);
      expect(r.invalidReason).toBe("binding_mismatch");
    });
  }

  it("REFUSES an altered amount, even with a resource that matches", async () => {
    const r = await verify(request({ amount: "1000", boundAmount: "1" }));
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("binding_mismatch");
  });

  it("REFUSES an altered method (declared method differs from the one signed)", async () => {
    // The attacker rewrites extra.method to POST while the MAC was minted for
    // GET. They cannot re-mint the MAC, so the recomputation fails.
    const bound = quoteExtra({ method: "GET" });
    const r = await verify(request({ extra: { ...bound, method: "POST" } }));
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("binding_mismatch");
  });

  it("REFUSES a forged binding", async () => {
    const r = await verify(
      request({ extra: { ...quoteExtra(), binding: "f".repeat(64) } })
    );
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("binding_mismatch");
  });

  it("REFUSES a truncated or empty binding without throwing on the length mismatch", async () => {
    // "" used to be read as "no binding presented" and degraded to unbound,
    // which accepted a payment whose own claim to be bound did not check out.
    // A partial binding is now all-or-nothing.
    const cases: Array<[string, string]> = [
      ["", "binding_incomplete"],
      ["ab", "binding_mismatch"],
      ["f".repeat(63), "binding_mismatch"],
      ["f".repeat(65), "binding_mismatch"],
    ];
    for (const [forged, expected] of cases) {
      const r = await verify(request({ extra: { ...quoteExtra(), binding: forged } }));
      expect(r.isValid, `binding=${JSON.stringify(forged)} must not verify`).toBe(false);
      expect(r.invalidReason).toBe(expected);
    }
  });

  it("a partial binding never degrades to unbound", () => {
    // Each of these presents SOME binding fields and not others.
    const partials = [
      { name: "USD Coin", version: "2", quoteId: "a".repeat(32) },
      { name: "USD Coin", version: "2", binding: "f".repeat(64) },
      { name: "USD Coin", version: "2", expiresAt: NOW + 300 },
      { name: "USD Coin", version: "2", quoteId: "a".repeat(32), expiresAt: NOW + 300 },
    ];
    for (const extra of partials) {
      const out = verifyResourceBinding({
        resource: RESOURCE,
        amountAtomic: AMOUNT,
        extra: extra as never,
        nowSeconds: NOW,
        require: false,
      });
      expect(out.ok, `partial ${JSON.stringify(extra)} must be refused`).toBe(false);
      if (!out.ok) expect(out.reason).toBe("binding_incomplete");
    }
  });

  it("REFUSES an expired quote", async () => {
    const out = verifyResourceBinding({
      resource: RESOURCE,
      method: "GET",
      amountAtomic: AMOUNT,
      extra: quoteExtra({ expiresAt: NOW - 1 }),
      nowSeconds: NOW,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("quote_expired");
  });
});

describe("SR1: resource structure is validated before any HMAC work", () => {
  const malformed: Array<[string, string, string]> = [
    ["empty", "", "resource_missing"],
    ["whitespace only", "   ", "resource_missing"],
    ["relative path", "/v1/quote", "resource_malformed"],
    ["bare word", "resource", "resource_malformed"],
    ["no scheme", "api.example.com/v1", "resource_malformed"],
    ["javascript scheme", "javascript:alert(1)", "resource_scheme_not_allowed"],
    ["file scheme", "file:///etc/passwd", "resource_scheme_not_allowed"],
    ["data scheme", "data:text/plain,x", "resource_scheme_not_allowed"],
    ["ftp scheme", "ftp://example.com/a", "resource_scheme_not_allowed"],
  ];

  for (const [label, resource, expected] of malformed) {
    it(`refuses ${label} as ${expected}`, () => {
      const out = verifyResourceBinding({
        resource,
        amountAtomic: AMOUNT,
        extra: quoteExtra(),
        nowSeconds: NOW,
      });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe(expected);
    });
  }

  it("refuses an over-long resource before hashing it", () => {
    const out = verifyResourceBinding({
      resource: "https://example.com/" + "a".repeat(4000),
      amountAtomic: AMOUNT,
      extra: quoteExtra(),
      nowSeconds: NOW,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("resource_too_long");
  });

  it("a missing resource is refused by verify() end to end", async () => {
    const r = await verify(request({ presentedAs: "" }));
    expect(r.isValid).toBe(false);
    expect(r.invalidReason).toBe("resource_missing");
  });
});

describe("SR1: canonicalisation folds only what the spec says is equivalent", () => {
  it("lowercases scheme and host, which ARE case-insensitive", () => {
    expect(canonicalResource("HTTPS://API.EXAMPLE.COM/v1/Quote")).toBe(
      "https://api.example.com/v1/Quote"
    );
  });

  it("preserves path case, which is NOT case-insensitive", () => {
    // Folding this would make two distinct resources compare equal — the exact
    // substitution this module exists to prevent.
    expect(canonicalResource("https://x.com/A")).not.toBe(canonicalResource("https://x.com/a"));
  });

  it("drops only the DEFAULT port", () => {
    expect(canonicalResource("https://x.com:443/a")).toBe("https://x.com/a");
    expect(canonicalResource("http://x.com:80/a")).toBe("http://x.com/a");
    expect(canonicalResource("https://x.com:8443/a")).toBe("https://x.com:8443/a");
  });

  it("keeps the query, and keeps it ordered as given", () => {
    expect(canonicalResource("https://x.com/a?b=1&c=2")).toBe("https://x.com/a?b=1&c=2");
    expect(canonicalResource("https://x.com/a?c=2&b=1")).not.toBe(
      canonicalResource("https://x.com/a?b=1&c=2")
    );
  });

  it("returns null for anything that is not an http(s) URL", () => {
    for (const bad of ["", "   ", "/rel", "nope", "javascript:x", "file:///x", "ws://x.com"]) {
      expect(canonicalResource(bad)).toBeNull();
    }
  });
});

describe("SR1: verify/settle divergence is detectable", () => {
  const base: NonceClaim = {
    resource: "https://api.example.com/v1/quote",
    amountAtomic: "1000",
    payTo: PAYER,
    claimedAtSeconds: NOW,
  };

  it("an identical re-presentation is consistent (a plain replay)", () => {
    expect(checkClaimConsistency(base, { ...base })).toEqual({ ok: true });
  });

  it("the SAME nonce presented for a DIFFERENT resource is a substitution", () => {
    const out = checkClaimConsistency(base, { ...base, resource: "https://api.example.com/v1/other" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("resource_mismatch");
      expect(out.detail).toContain("v1/other");
    }
  });

  it("a different amount or recipient on the same nonce is caught", () => {
    const amount = checkClaimConsistency(base, { ...base, amountAtomic: "2000" });
    expect(amount.ok).toBe(false);
    if (!amount.ok) expect(amount.reason).toBe("amount_mismatch");

    const payee = checkClaimConsistency(base, { ...base, payTo: "0x" + "2".repeat(40) });
    expect(payee.ok).toBe(false);
    if (!payee.ok) expect(payee.reason).toBe("recipient_mismatch");
  });

  it("recipient comparison is case-insensitive, so a checksum variant is not a mismatch", () => {
    const upper = { ...base, payTo: "0x" + "1".repeat(40).toUpperCase() };
    expect(checkClaimConsistency(base, upper)).toEqual({ ok: true });
  });
});

describe("SR1: legacy quotes without extra.method still verify, narrowly", () => {
  it("a quote minted before extra.method existed still verifies for GET and POST", () => {
    for (const method of ["GET", "POST"]) {
      const quoteId = "b".repeat(32);
      const expiresAt = NOW + 300;
      const legacy = {
        name: "USD Coin",
        version: "2",
        quoteId,
        expiresAt,
        binding: bindingMac(RESOURCE, method, AMOUNT, quoteId, expiresAt),
        // method deliberately absent
      };
      const out = verifyResourceBinding({
        resource: RESOURCE,
        amountAtomic: AMOUNT,
        extra: legacy,
        nowSeconds: NOW,
      });
      expect(out.ok, `legacy ${method} quote must verify`).toBe(true);
      if (out.ok) expect(out.bound).toBe(true);
    }
  });

  it("the legacy fallback does NOT let a caller forge a binding", () => {
    // The fallback widens which METHOD is accepted, never which resource: the
    // MAC is still keyed with our secret.
    const out = verifyResourceBinding({
      resource: "https://evil.example.com/x",
      amountAtomic: AMOUNT,
      extra: { name: "USD Coin", version: "2", quoteId: "c".repeat(32), expiresAt: NOW + 300, binding: "e".repeat(64) },
      nowSeconds: NOW,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("binding_mismatch");
  });
});
