import crypto from "crypto";
import { bindingMac } from "@/lib/x402";

// ---------------------------------------------------------------------------
// SR1 — resource binding at the facilitator.
//
// arXiv:2607.19545 SR1: "a facilitator must return invalid if the payment proof
// does not match the server-declared requirements." The facilitator checked
// scheme, network, payTo and amount — and never the RESOURCE. That is the
// paper's F1 (cross-resource substitution), and the concrete leak is not double
// settlement (the single-use nonce closes that) but DOUBLE DELIVERY:
//
//   1. Attacker buys cheap resource A and obtains a valid authorization.
//   2. Resource server A calls /verify -> isValid. It serves A.
//   3. The SAME authorization is presented to resource server B, same price and
//      same payTo. B calls /verify -> isValid, because nothing compares the
//      resource. B serves its content too.
//   4. Only one /settle can win the nonce, so ONE payment bought TWO resources.
//
// `/verify` is advisory and burns nothing, which is exactly why the resource has
// to be checked there.
//
// WHAT BINDS IT, AND WHY IT IS NOT NEW MACHINERY. lib/x402.ts already issues
// every 402 quote with `extra.binding` = HMAC(method, resource, amount, quoteId,
// expiresAt) under our own secret, and its resource-server middleware already
// verifies it. The facilitator simply never did. This module is that missing
// half, reusing the same `bindingMac` so the two cannot drift: one function
// mints the commitment, one function checks it.
//
// THE PROTOCOL LIMIT, STATED PLAINLY. EIP-3009 signs from/to/value/validAfter/
// validBefore/nonce and NOTHING about the resource, so the payer's signature can
// never itself commit to a resource. Binding is therefore an HMAC we issue, not
// a signature the payer produced — which is sound against a caller (they cannot
// forge our MAC) and is NOT a defence against a malicious resource server that
// holds our secret. Full cryptographic binding would need the resource inside
// the signed payload, which the `exact` scheme does not offer. SR1 is therefore
// MET for callers and PARTIAL by protocol constraint; the audit says so.
//
// THIRD-PARTY SERVERS. A resource server that is not us cannot produce our MAC,
// so an absent binding is reported rather than rejected by default, and
// `X402_REQUIRE_RESOURCE_BINDING=1` makes it mandatory for a deployment that
// only serves its own resources. Verifying a binding that IS present is always
// strict: an unverified claim is worse than no claim.
// ---------------------------------------------------------------------------

/** Longest resource identifier we will consider. Bounds hashing work and keeps
 *  a pathological URL out of the logs. */
const MAX_RESOURCE_BYTES = 2048;

export type ResourceBindingOutcome =
  | { readonly ok: true; readonly bound: true; readonly resource: string; readonly quoteId: string }
  /** Structurally valid, no binding presented. `bound: false` is carried
   *  forward so a caller can see the payment was not tied to this resource. */
  | { readonly ok: true; readonly bound: false; readonly resource: string }
  | {
      readonly ok: false;
      readonly reason:
        | "resource_missing"
        | "resource_malformed"
        | "resource_too_long"
        | "resource_scheme_not_allowed"
        | "binding_required"
        | "binding_incomplete"
        | "binding_mismatch"
        | "quote_expired";
      readonly detail: string;
    };

/** True when this deployment refuses an unbound payment. */
export function resourceBindingRequired(): boolean {
  return process.env.X402_REQUIRE_RESOURCE_BINDING === "1";
}

/**
 * Canonical form of a resource identifier, for comparison and for hashing.
 *
 * NORMALISATION IS DELIBERATELY MINIMAL. Only the parts of a URL that are
 * case-insensitive BY SPECIFICATION are lowered: the scheme and the host. The
 * path, query and fragment are left exactly as given, because `/A` and `/a` are
 * different resources on most servers and folding them would make two distinct
 * resources compare equal — the very substitution this module exists to stop.
 *
 * A default port is dropped, since `https://x.com:443/a` and `https://x.com/a`
 * are the same resource by RFC 3986.
 */
export function canonicalResource(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  if (scheme !== "https:" && scheme !== "http:") return null;
  const defaultPort = scheme === "https:" ? "443" : "80";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  // `url.pathname` is already percent-normalised by the URL parser, which is
  // what makes `/a%2Fb` and `/a/b` stay distinct rather than collapsing.
  return `${scheme}//${url.hostname.toLowerCase()}${port}${url.pathname}${url.search}`;
}

export interface VerifyResourceBindingInput {
  /** The resource the requirements declare. */
  readonly resource: string;
  /** HTTP method the quote was issued for. Defaults to GET, matching x402. */
  readonly method?: string;
  /** Atomic amount from the requirements — part of the commitment. */
  readonly amountAtomic: string;
  readonly extra?: { quoteId?: string; expiresAt?: number; binding?: string } | null;
  readonly nowSeconds: number;
  readonly require?: boolean;
}

/**
 * Check that a payment is for the resource the requirements name.
 *
 * Structure first, then the MAC. A malformed resource must not reach the HMAC:
 * hashing attacker-controlled bytes of unbounded length is work we are doing on
 * their behalf, and the failure reason would be misleading.
 */
export function verifyResourceBinding(input: VerifyResourceBindingInput): ResourceBindingOutcome {
  const raw = input.resource;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, reason: "resource_missing", detail: "payment requirements name no resource" };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_RESOURCE_BYTES) {
    return {
      ok: false,
      reason: "resource_too_long",
      detail: `resource exceeds ${MAX_RESOURCE_BYTES} bytes`,
    };
  }
  const canonical = canonicalResource(raw);
  if (!canonical) {
    // Distinguish "not a URL at all" from "a URL we will not serve", because
    // the second is a configuration answer and the first is a client bug.
    let parsed: URL | null = null;
    try {
      parsed = new URL(raw.trim());
    } catch {
      parsed = null;
    }
    if (parsed) {
      return {
        ok: false,
        reason: "resource_scheme_not_allowed",
        detail: `scheme ${parsed.protocol} is not http or https`,
      };
    }
    return { ok: false, reason: "resource_malformed", detail: "resource is not an absolute URL" };
  }

  const required = input.require ?? resourceBindingRequired();
  const quoteId = input.extra?.quoteId;
  const binding = input.extra?.binding;
  const expiresAt = input.extra?.expiresAt;

  // A PARTIAL binding is never treated as an absent one.
  //
  // The three fields are one commitment. A caller who supplied a `quoteId` but
  // an empty `binding` plainly intended to bind, and degrading that to
  // "unbound, carry on" is the worst available reading: it accepts a payment
  // whose own claim to be bound did not check out. So the rule is all-or-nothing
  // — present none of them and you are unbound; present any and you must present
  // all three, valid.
  const present = [quoteId, binding, expiresAt].filter(
    (v) => v !== undefined && v !== null && v !== ""
  ).length;
  const complete =
    typeof quoteId === "string" &&
    quoteId !== "" &&
    typeof binding === "string" &&
    binding !== "" &&
    typeof expiresAt === "number";

  if (!complete) {
    if (present > 0) {
      return {
        ok: false,
        reason: "binding_incomplete",
        detail:
          "a partial quote binding was presented: extra.quoteId, extra.binding and extra.expiresAt " +
          "are one commitment and must all be present; re-request the 402 quote",
      };
    }
    if (required) {
      return {
        ok: false,
        reason: "binding_required",
        detail:
          "this deployment requires a quote binding (extra.quoteId, extra.binding, extra.expiresAt); " +
          "re-request the 402 quote",
      };
    }
    return { ok: true, bound: false, resource: canonical };
  }

  // The guard above established all three; name them non-optionally so the rest
  // of the function reads without assertions.
  const boundQuoteId: string = quoteId as string;
  const boundMac: string = binding as string;
  const boundExpiresAt: number = expiresAt as number;

  if (input.nowSeconds > boundExpiresAt) {
    return { ok: false, reason: "quote_expired", detail: `quote expired at ${boundExpiresAt}` };
  }

  // The MAC commits to the resource AS THE QUOTE WAS ISSUED, so it is computed
  // over the raw declared string rather than the canonical form — otherwise a
  // quote minted for `https://X.com/a` would not verify when presented as
  // `https://x.com/a`, and vice versa. Both spellings are checked so a caller
  // may normalise without invalidating their own quote.
  //
  // METHODS: the quote states its own method (`extra.method`), which is what
  // makes the commitment verifiable here at all. A quote WITHOUT it predates
  // that field, and rather than refuse it we try the only two methods this
  // codebase prices resources with. That fallback narrows the binding to
  // resource+amount for legacy quotes — it cannot be widened by a caller, since
  // they still cannot forge the MAC, and it disappears after one quote TTL.
  const declaredMethod = typeof input.method === "string" && input.method.trim() ? input.method : undefined;
  const methods = declaredMethod ? [declaredMethod.toUpperCase()] : ["GET", "POST"];
  const resources = [raw.trim(), canonical];
  for (const method of methods) {
    for (const candidate of resources) {
      const expected = bindingMac(candidate, method, input.amountAtomic, boundQuoteId, boundExpiresAt);
      if (timingSafeEqualHex(expected, boundMac)) {
        return { ok: true, bound: true, resource: canonical, quoteId: boundQuoteId };
      }
    }
  }
  return {
    ok: false,
    reason: "binding_mismatch",
    detail: "payment is bound to a different resource, method or amount than the one presented",
  };
}

/** Constant-time comparison that never throws on a length mismatch. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof b !== "string" || a.length !== b.length) return false;
  const x = new Uint8Array(Buffer.from(a));
  const y = new Uint8Array(Buffer.from(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ── verify/settle divergence ───────────────────────────────────────────────

/**
 * The value stored alongside a claimed nonce so a later settle can be checked
 * against the resource the authorization was verified for.
 *
 * THE GAP THIS CLOSES. `/verify` and `/settle` are separate HTTP calls carrying
 * their own bodies. Without recording the resource at claim time, an
 * authorization could be verified for resource A and settled for resource B —
 * the nonce is single-use so only one settle wins, but the settlement RECORD and
 * the evidence would name a resource the payer never authorized.
 */
export interface NonceClaim {
  readonly resource: string;
  readonly amountAtomic: string;
  readonly payTo: string;
  readonly claimedAtSeconds: number;
}

export type ClaimCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "resource_mismatch" | "amount_mismatch" | "recipient_mismatch"; readonly detail: string };

/** Compare a settle attempt against what was recorded when the nonce was claimed. */
export function checkClaimConsistency(previous: NonceClaim, now: NonceClaim): ClaimCheck {
  if (previous.resource !== now.resource) {
    return {
      ok: false,
      reason: "resource_mismatch",
      detail: `this nonce was claimed for ${previous.resource} and is now presented for ${now.resource}`,
    };
  }
  if (previous.amountAtomic !== now.amountAtomic) {
    return {
      ok: false,
      reason: "amount_mismatch",
      detail: `this nonce was claimed for ${previous.amountAtomic} and is now presented for ${now.amountAtomic}`,
    };
  }
  if (previous.payTo.toLowerCase() !== now.payTo.toLowerCase()) {
    return {
      ok: false,
      reason: "recipient_mismatch",
      detail: "this nonce was claimed for a different recipient",
    };
  }
  return { ok: true };
}
