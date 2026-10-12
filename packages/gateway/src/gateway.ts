import crypto from "node:crypto";
import {
  DEFAULT_QUOTE_TTL_SECONDS,
  HEADER_V1_RECEIPT,
  HEADER_V2_RECEIPT,
  HEADER_V2_REQUIRED,
  LATEST_X402_VERSION,
  NETWORK_USDC,
  REPLAY_CLAIM_TTL_SECONDS,
  canonicalNonce,
  USDC_DECIMALS,
  atomicAmount,
  b64encode,
  bindingMac,
  decodePayment,
  detectVersion,
  encodeReceiptV1,
  encodeReceiptV2,
  hashBody,
  noStoreHeaders,
  requiredConfirmations,
  timingSafeEqualHex,
  type HeaderLookup,
  type PaymentRequiredV1,
  type PaymentRequiredV2,
  type PaymentRequirementsV1,
  type PaymentRequirementsV2,
  type QuoteExtra,
  type ResourceInfo,
  type SettlementReceipt,
  type X402Version,
} from "./protocol.js";
import {
  FURLPAY_FACILITATOR,
  httpFacilitator,
  type FacilitatorClient,
  type FacilitatorRequest,
} from "./facilitator.js";
import { MemoryClaimStore, type ClaimStore } from "./store.js";
import {
  canonicalNetwork,
  legacyNetworkNames,
  nativeStablecoin,
  resolveAsset,
  type AssetId,
  type AssetNetwork,
} from "./assets.js";

// ---------------------------------------------------------------------------
// The gateway.
//
// One rule governs this file: NOTHING the client sends is trusted. The client
// echoes back the quote it claims to be paying — in v1 as `extra`, in v2 as the
// full `accepted` requirements — and every one of those fields is re-derived
// from server-side state and compared before a byte of the resource is released.
// The client's copy is a lookup key, never an assertion.
// ---------------------------------------------------------------------------

export interface RequestContext {
  method: string;
  /** Canonical resource identity — the absolute URL, including query. */
  resource: string;
  url: URL;
  headers: Headers;
}

export type PriceResolver = number | ((ctx: RequestContext) => number | Promise<number>);

export interface GatewayOptions {
  price: PriceResolver;
  payTo: string;
  /** HMAC secret binding quotes to resources. No default — a published default
   *  would be a forgeable quote for every deployment that didn't override it. */
  quoteSecret: string;
  network?: string;
  asset?: string;
  assetName?: string;
  assetVersion?: string;
  facilitator?: FacilitatorClient | string;
  /** Pin the dialect used to talk to the facilitator. Default: mirror the
   *  client. Set to 1 when pointing at a v1-only facilitator. */
  facilitatorVersion?: X402Version;
  claimStore?: ClaimStore;
  quoteTtlSeconds?: number;
  description?: string | ((ctx: RequestContext) => string);
  mimeType?: string;
  /** v2 discovery metadata. These are the protocol's native fields — a
   *  facilitator can crawl them, so filling them in is how the resource becomes
   *  discoverable without any proprietary index. */
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
  /** Bind the quote to a hash of the request body (default on for POST/PUT/PATCH).
   *  Without it, a payment for {"model":"small"} also unlocks {"model":"large"}. */
  bindBody?: boolean;
  /** Settle on-chain before releasing (default). `false` verifies but does not
   *  collect — only correct if you settle out of band. */
  settle?: boolean;
  resource?: (ctx: { method: string; url: URL }) => string;
  onSettled?: (receipt: SettlementReceipt) => void | Promise<void>;
  onRejected?: (info: { reason: string; resource: string; payer?: string }) => void | Promise<void>;

  /**
   * Spend policy for the paying agent.
   *
   * WHY THIS IS A HOOK AND NOT AN IMPORT. The gateway must not depend on
   * @furlpay/agent-trust: an operator who wants a plain paywall should not be
   * made to carry a policy engine, and an operator with their own policy
   * system should be able to use it. The shape below is exactly what
   * SpendLimiter provides, so wiring the two together is one line — but
   * nothing here knows that.
   *
   * ORDERING IS THE WHOLE POINT. `reserve` is called AFTER the payment is
   * cryptographically verified (so the payer identity is real, not claimed)
   * and BEFORE settlement (so an over-budget agent never has money taken).
   * The reservation is committed only once settlement succeeds, and released
   * on any failure — so a failed payment never permanently consumes budget.
   */
  policy?: SpendPolicyHook;
  /**
   * Decides how long to wait before releasing the resource, given the amount
   * and the chain.
   *
   * Omit it and the gateway uses `requiredConfirmations`, a chain-blind count
   * that is correct enough for a single-chain deployment and wrong the moment
   * the same code serves Solana and an optimistic rollup. Supply
   * `@furlpay/settlement` here to get per-chain finality, risk tiers and
   * consensus-upgrade awareness.
   */
  settlementPolicy?: SettlementPolicy;
}

/**
 * The contract a spend-policy engine implements. Deliberately minimal: three
 * methods, no types imported from anywhere.
 */
export interface SpendPolicyHook {
  /**
   * Take headroom for `amountAtomic` on behalf of `agentId`, or refuse.
   *
   * MUST be atomic with respect to concurrent calls. A check-then-act
   * implementation lets N parallel requests all pass a limit that should have
   * stopped the Nth, and the money is gone before the counter catches up.
   */
  reserve(input: {
    agentId: string;
    endpoint: string;
    amountAtomic: string;
  }): Promise<PolicyVerdict> | PolicyVerdict;
  /** The payment settled; make the reservation permanent. */
  commit(reservationId: string): Promise<void> | void;
  /** The payment did not settle; give the headroom back. */
  release(reservationId: string): Promise<void> | void;
}

/**
 * What a settlement policy says about one payment.
 *
 * Richer than a confirmation count on purpose. `requiredConfirmations` below
 * answers "how many blocks", which is the only question a chain-blind gateway
 * can ask — but twelve confirmations means something entirely different on
 * Solana (~400ms slots) than on Base (~2s blocks), and on an optimistic
 * rollup no amount of waiting produces finality at all. A policy that knows
 * the chain can say so; this shape lets it.
 */
export interface SettlementVerdict {
  /** Confirmations to require before releasing the resource. */
  confirmations: number;
  /**
   * Expected wait, or null when the chain cannot answer the question this
   * tier asks. Callers MUST branch on null rather than defaulting it.
   */
  expectedWaitMs: number | null;
  /**
   * True when waiting will NEVER satisfy the requirement — an optimistic
   * rollup asked for finality, for instance. The gateway refuses rather than
   * releasing, because the alternative is calling a payment settled that by
   * this policy's own definition is not.
   */
  unsatisfiable: boolean;
  /** Tier name, for the receipt and for logs. */
  tier: string;
  /** One sentence a human can act on. */
  explanation: string;
}

/**
 * An injectable settlement policy.
 *
 * Injected rather than imported so this package keeps its zero-runtime-
 * dependency contract: `@furlpay/settlement` knows about chains, tiers and
 * consensus upgrades, and none of that belongs inside an x402 protocol
 * implementation. Omit it and the gateway falls back to
 * `requiredConfirmations`, which is the behaviour every existing deployment
 * already has.
 */
export interface SettlementPolicy {
  forPayment(input: {
    /** Integer atomic units, as a decimal string. */
    amountAtomic: string;
    decimals: number;
    /** The gateway's canonical `chain:network`. */
    network: string;
  }): SettlementVerdict;
}

export type PolicyVerdict =
  | { ok: true; reservationId: string }
  | { ok: false; reason: string; message: string };

export type GatewayDecision =
  | { kind: "allow"; receipt: SettlementReceipt; headers: Record<string, string> }
  | { kind: "challenge"; status: 402; body: PaymentRequiredV1; headers: Record<string, string> }
  | { kind: "reject"; status: 400; body: { error: string }; headers: Record<string, string> }
  /**
   * Policy refused. 403, NOT 402, and the distinction is load-bearing.
   *
   * A 402 means "pay and retry". An agent that has exhausted its daily budget
   * would read that as an instruction to pay again — burning more money on a
   * request that can never be authorised, in a loop, because it is a machine
   * and will not get bored. 403 says the thing that is actually true: you are
   * not permitted, and paying will not change that.
   */
  | {
      kind: "deny";
      status: 403;
      body: { error: string; reason: string; message: string };
      headers: Record<string, string>;
    };

export interface AuthorizeInput {
  method: string;
  url: string | URL;
  headers: Headers | Record<string, string | undefined>;
  /** Raw request body. Required for body binding on POST/PUT/PATCH. */
  body?: string | Buffer;
}

/** The server-side truth about a quote. Both wire dialects render from this. */
interface MintedQuote {
  method: string;
  resource: string;
  amount: string;
  quoteId: string;
  expiresAt: number;
  bodyHash?: string;
  description: string;
  mimeType: string;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function lookup(headers: AuthorizeInput["headers"]): HeaderLookup {
  if (typeof (headers as Headers).get === "function") {
    return (name) => (headers as Headers).get(name);
  }
  const rec = headers as Record<string, string | undefined>;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) if (v !== undefined) lower[k.toLowerCase()] = v;
  return (name) => lower[name.toLowerCase()] ?? null;
}

export class Gateway {
  private readonly facilitator: FacilitatorClient;
  private readonly claims: ClaimStore;
  private readonly network: string;
  private readonly asset: string;
  /** The resolved asset, carrying its own network and decimals. */
  private readonly assetId: AssetId;
  private readonly canonical: AssetNetwork;
  private readonly ttl: number;

  constructor(private readonly opts: GatewayOptions) {
    if (!opts.quoteSecret || opts.quoteSecret.length < 16) {
      throw new Error(
        "@furlpay/gateway: `quoteSecret` is required and must be at least 16 chars. " +
          "Generate one with: npx @furlpay/gateway secret"
      );
    }
    if (!opts.payTo) throw new Error("@furlpay/gateway: `payTo` is required.");

    this.network = opts.network ?? "base";

    // ASSET IDENTITY IS RESOLVED, NEVER ACCEPTED.
    //
    // This previously read `opts.asset ?? NETWORK_USDC[this.network]`, so a
    // caller-supplied asset bypassed the network map entirely and nothing
    // checked that the two agreed. `{ network: "solana-devnet", asset:
    // <mainnet mint> }` constructed happily — and because "solana-devnet" was
    // missing from that map while both EVM testnets were present, the devnet
    // rail was FORCED down exactly that unchecked path.
    //
    // Now every asset goes through the registry, which knows which network it
    // belongs to. A mismatch is a construction-time throw rather than a quote
    // naming an asset that cannot exist on the rail it will settle on.
    const canonical = canonicalNetwork(this.network);
    if (!canonical) {
      throw new Error(
        `@furlpay/gateway: unknown network "${this.network}" — one of: ${legacyNetworkNames().join(", ")}`
      );
    }
    this.canonical = canonical;
    // `resolveAsset` throws AssetNetworkMismatchError when the address is
    // registered on a DIFFERENT network — the loud case — and UnknownAssetError
    // when it is registered nowhere.
    this.assetId = opts.asset
      ? resolveAsset(canonical, opts.asset)
      : nativeStablecoin(canonical);
    this.asset = this.assetId.address;
    this.ttl = opts.quoteTtlSeconds ?? DEFAULT_QUOTE_TTL_SECONDS;
    this.claims = opts.claimStore ?? new MemoryClaimStore();
    this.facilitator =
      typeof opts.facilitator === "string"
        ? httpFacilitator(opts.facilitator)
        : (opts.facilitator ?? httpFacilitator(FURLPAY_FACILITATOR));
  }

  /** The mint/contract this gateway quotes and settles in. Resolved from the
   *  registry, never taken on trust from the caller. */
  get assetAddress(): string {
    return this.assetId.address;
  }

  /** This asset's decimals. Read from the asset itself rather than a global
   *  constant, so a non-6dp asset cannot be silently mispriced. */
  get assetDecimals(): number {
    return this.assetId.decimals;
  }

  /** The canonical `chain:network` form. The wire keeps its legacy short name
   *  for compatibility; this is the unambiguous one for logs and evidence. */
  get canonicalNetwork(): AssetNetwork {
    return this.canonical;
  }

  /** True when replay claims are shared across instances. Assert this at boot in
   *  any multi-instance deployment. */
  get replayProtectionDurable(): boolean {
    return this.claims.isDurable;
  }

  // ── quoting ─────────────────────────────────────────────────────────────

  private resourceId(method: string, url: URL): string {
    if (this.opts.resource) return this.opts.resource({ method, url });
    return `${url.origin}${url.pathname}${url.search}`;
  }

  private context(input: AuthorizeInput): RequestContext {
    const url = input.url instanceof URL ? input.url : new URL(input.url);
    const method = input.method.toUpperCase();
    return {
      method,
      resource: this.resourceId(method, url),
      url,
      headers: input.headers instanceof Headers ? input.headers : new Headers(),
    };
  }

  private async priceFor(ctx: RequestContext): Promise<number> {
    return typeof this.opts.price === "function" ? await this.opts.price(ctx) : this.opts.price;
  }

  private describe(ctx: RequestContext): string {
    if (typeof this.opts.description === "function") return this.opts.description(ctx);
    return this.opts.description ?? `${ctx.method} ${ctx.url.pathname} (per call)`;
  }

  private shouldBindBody(method: string, body?: string | Buffer): boolean {
    if (this.opts.bindBody === false) return false;
    if (!BODY_METHODS.has(method)) return false;
    if (body === undefined || body === null) return false;
    return body.length > 0;
  }

  /** Mint a fresh quote for this request. */
  private async mint(input: AuthorizeInput): Promise<MintedQuote> {
    const ctx = this.context(input);
    const amount = atomicAmount(await this.priceFor(ctx), USDC_DECIMALS);
    return {
      method: ctx.method,
      resource: ctx.resource,
      amount,
      quoteId: crypto.randomBytes(16).toString("hex"),
      expiresAt: Math.floor(Date.now() / 1000) + this.ttl,
      bodyHash: this.shouldBindBody(ctx.method, input.body) ? hashBody(input.body!) : undefined,
      description: this.describe(ctx),
      mimeType: this.opts.mimeType ?? "application/json",
    };
  }

  private extraFor(q: MintedQuote): QuoteExtra {
    return {
      name: this.opts.assetName ?? "USD Coin",
      version: this.opts.assetVersion ?? "2",
      quoteId: q.quoteId,
      expiresAt: q.expiresAt,
      binding: bindingMac(this.opts.quoteSecret, {
        method: q.method,
        resource: q.resource,
        amount: q.amount,
        quoteId: q.quoteId,
        expiresAt: q.expiresAt,
        bodyHash: q.bodyHash,
      }),
      ...(q.bodyHash ? { bodyHash: q.bodyHash } : {}),
    };
  }

  private toV1(q: MintedQuote): PaymentRequirementsV1 {
    return {
      scheme: "exact",
      network: this.network,
      maxAmountRequired: q.amount,
      resource: q.resource,
      description: q.description,
      mimeType: q.mimeType,
      payTo: this.opts.payTo,
      maxTimeoutSeconds: this.ttl,
      asset: this.asset,
      extra: this.extraFor(q),
    };
  }

  private toV2(q: MintedQuote): PaymentRequirementsV2 {
    return {
      scheme: "exact",
      network: this.network,
      asset: this.asset,
      amount: q.amount,
      payTo: this.opts.payTo,
      maxTimeoutSeconds: this.ttl,
      extra: this.extraFor(q),
    };
  }

  private resourceInfo(q: MintedQuote): ResourceInfo {
    return {
      url: q.resource,
      description: q.description,
      mimeType: q.mimeType,
      ...(this.opts.serviceName ? { serviceName: this.opts.serviceName } : {}),
      ...(this.opts.tags?.length ? { tags: this.opts.tags } : {}),
      ...(this.opts.iconUrl ? { iconUrl: this.opts.iconUrl } : {}),
    };
  }

  /** Public quote surface — the v2 402 payload for this request. */
  async quote(input: AuthorizeInput): Promise<PaymentRequiredV2> {
    const q = await this.mint(input);
    return { x402Version: 2, resource: this.resourceInfo(q), accepts: [this.toV2(q)] };
  }

  /**
   * A 402 advertises BOTH dialects: v2 in the PAYMENT-REQUIRED header, v1 in the
   * body. v2 moving payment data out of the body is exactly what makes this
   * possible — a v2 client reads the header, a v1 client reads the body, and
   * neither needs to know the other exists.
   */
  private async challenge(input: AuthorizeInput, error: string): Promise<GatewayDecision> {
    const q = await this.mint(input);
    const v2: PaymentRequiredV2 = {
      x402Version: 2,
      error,
      resource: this.resourceInfo(q),
      accepts: [this.toV2(q)],
    };
    const v1: PaymentRequiredV1 = { x402Version: 1, error, accepts: [this.toV1(q)] };
    return {
      kind: "challenge",
      status: 402,
      body: v1,
      headers: {
        ...noStoreHeaders,
        "Content-Type": "application/json",
        [HEADER_V2_REQUIRED]: b64encode(v2),
      },
    };
  }

  private reject(error: string): GatewayDecision {
    return {
      kind: "reject",
      status: 400,
      body: { error },
      headers: { ...noStoreHeaders, "Content-Type": "application/json" },
    };
  }

  /**
   * Policy refusal. 403 and never 402 — see the `deny` variant on
   * GatewayDecision for why that distinction stops an agent looping.
   *
   * `reason` is a stable machine code the agent can branch on;
   * `message` is the sentence a human reads. Neither discloses the limit
   * itself: an agent does not need to know an operator's daily cap to
   * understand that it has been refused, and publishing it invites probing.
   */
  private deny(reason: string, message: string): GatewayDecision {
    return {
      kind: "deny",
      status: 403,
      body: { error: "policy_denied", reason, message },
      headers: { ...noStoreHeaders, "Content-Type": "application/json" },
    };
  }

  // ── the gate ────────────────────────────────────────────────────────────

  /**
   * Returns `allow` only when a payment has been verified against a
   * server-derived quote, burned as single-use, and settled to the confirmation
   * depth its value requires.
   */
  async authorize(input: AuthorizeInput): Promise<GatewayDecision> {
    const ctx = this.context(input);
    const get = lookup(input.headers);
    const clientVersion = detectVersion(get);

    if (clientVersion === null) return this.challenge(input, "Payment required");

    const decoded = decodePayment(get);
    if (!decoded.ok) {
      // Malformed is the client's bug, not a pricing failure — a 402 here would
      // invite the agent to pay again against a payload we could not even read.
      await this.opts.onRejected?.({ reason: decoded.error, resource: ctx.resource });
      return this.reject(decoded.error);
    }
    const p = decoded.payment;
    const auth = p.authorization;

    const fail = async (reason: string): Promise<GatewayDecision> => {
      await this.opts.onRejected?.({ reason, resource: ctx.resource, payer: auth.from });
      return this.challenge(input, reason);
    };

    // ── re-derive the expectation; the client's echo is never the source ──
    const expectedAmount = atomicAmount(await this.priceFor(ctx), USDC_DECIMALS);

    if (p.scheme !== "exact") return fail("Unsupported scheme");
    if (p.network !== this.network) return fail(`Wrong network (expected ${this.network})`);
    if (auth.to.toLowerCase() !== this.opts.payTo.toLowerCase()) {
      return fail("Payment not addressed to this recipient");
    }

    // Integer compare — "9000" > "10000" lexicographically.
    try {
      if (BigInt(auth.value) < BigInt(expectedAmount)) {
        return fail(`Insufficient amount (expected ${expectedAmount} atomic units)`);
      }
    } catch {
      return fail("Invalid amount");
    }

    // ── binding: this resource, this price, this body? ──
    const { quoteId, binding, expiresAt } = p;
    if (!quoteId || !binding || typeof expiresAt !== "number") {
      return fail("Missing quote binding (re-request the 402 quote)");
    }

    let bodyHash: string | undefined;
    if (this.shouldBindBody(ctx.method, input.body)) {
      bodyHash = hashBody(input.body!);
      if (!p.bodyHash) return fail("Quote is not body-bound (re-request the 402 quote)");
      if (!timingSafeEqualHex(p.bodyHash, bodyHash)) {
        return fail("Body does not match the body this quote was issued for");
      }
    }

    const expectedMac = bindingMac(this.opts.quoteSecret, {
      method: ctx.method,
      resource: ctx.resource,
      amount: expectedAmount,
      quoteId,
      expiresAt,
      bodyHash,
    });
    if (!timingSafeEqualHex(expectedMac, binding)) {
      // The most important line in this file: a payment minted for a cheap
      // resource dies here when presented to an expensive one.
      return fail("Quote binding mismatch (payment bound to a different resource)");
    }

    // ── freshness ──
    const now = Math.floor(Date.now() / 1000);
    if (now > expiresAt) return fail("Quote expired (re-request the 402 quote)");
    // Both bounds must be plain integers. They were compared only when
    // Number() happened to parse them, so "abc" skipped the expiry check.
    if (!/^\d{1,15}$/.test(auth.validAfter) || !/^\d{1,15}$/.test(auth.validBefore)) {
      return fail("Malformed authorization validity window");
    }
    const validAfter = Number(auth.validAfter);
    const validBefore = Number(auth.validBefore);
    if (now < validAfter) return fail("Authorization not yet valid");
    if (now > validBefore) return fail("Authorization expired");
    // The replay claim is remembered for REPLAY_CLAIM_TTL_SECONDS. An
    // authorization that stays valid longer than that could be presented again
    // after its claim has expired, so it is not accepted in the first place.
    if (validBefore > now + REPLAY_CLAIM_TTL_SECONDS - 600) {
      return fail("Authorization validity window is too long");
    }
    const nonce = canonicalNonce(this.network, auth.nonce);
    if (!nonce) return fail("Malformed authorization nonce");

    // ── single-use. Nonce first: it is the money-level token, so burning it
    // before the quote means a racing replay never reaches settlement. ──
    // Key shape is shared with apps/web's gasless transfer route, which claims
    // the same nonce in the same namespace. Keep the two in step.
    if (!(await this.claims.claim(`x402:nonce:${nonce}`, REPLAY_CLAIM_TTL_SECONDS))) {
      return fail("Authorization already used (replay)");
    }
    if (!(await this.claims.claim(`x402:quote:${quoteId}`, REPLAY_CLAIM_TTL_SECONDS))) {
      return fail("Quote already redeemed (replay)");
    }

    // ── verify + settle, in the dialect the facilitator speaks ──
    const q: MintedQuote = {
      method: ctx.method,
      resource: ctx.resource,
      amount: expectedAmount,
      quoteId,
      expiresAt,
      bodyHash,
      description: this.describe(ctx),
      mimeType: this.opts.mimeType ?? "application/json",
    };
    const fReq = this.facilitatorRequest(q, p, clientVersion);

    // ── spend policy ─────────────────────────────────────────────────────
    //
    // HERE, and not earlier or later, for two reasons.
    //
    // NOT EARLIER: the agent identity used for budgeting is `auth.from`, and
    // until the binding MAC and the nonce claim above have passed, that is a
    // value the client asserted rather than one the payment proves. Budgeting
    // against an unverified identity lets an agent spend someone else's
    // allowance by claiming to be them.
    //
    // NOT LATER: settlement moves money. An over-budget agent must be refused
    // BEFORE that, or the policy is a report rather than a control.
    //
    // The reservation is committed only when settlement succeeds and released
    // on every failure path below, so a payment that does not complete never
    // permanently consumes budget.
    const payerId = auth.from;
    let reservationId: string | null = null;
    if (this.opts.policy) {
      let verdict: PolicyVerdict;
      try {
        verdict = await this.opts.policy.reserve({
          agentId: payerId,
          endpoint: ctx.resource,
          amountAtomic: expectedAmount,
        });
      } catch (e) {
        // A policy engine that throws cannot be trusted to have refused, and
        // an authorisation layer that cannot evaluate its policy has exactly
        // one safe answer.
        await this.opts.onRejected?.({
          reason: "policy_unavailable",
          resource: ctx.resource,
          payer: payerId,
        });
        return this.deny(
          "policy_unavailable",
          "Spend policy could not be evaluated, so the request was refused."
        );
      }
      if (!verdict.ok) {
        await this.opts.onRejected?.({
          reason: verdict.reason,
          resource: ctx.resource,
          payer: payerId,
        });
        return this.deny(verdict.reason, verdict.message);
      }
      reservationId = verdict.reservationId;
    }

    /** Give budget back on any path that does not settle. */
    const releaseReservation = async (): Promise<void> => {
      if (!reservationId || !this.opts.policy) return;
      try {
        await this.opts.policy.release(reservationId);
      } catch {
        // A failed release costs headroom until the reservation's TTL expires.
        // It must never turn a payment failure into a thrown request.
      }
      reservationId = null;
    };

    if (this.opts.settle === false) {
      const verdict = await this.facilitator.verify(fReq);
      if (!verdict.isValid) {
        await releaseReservation();
        return fail(verdict.invalidReason ?? "Payment verification failed");
      }
      // settle:false means the operator collects out of band, so from the
      // policy's point of view the spend has happened and the reservation
      // becomes permanent. Releasing here would let an agent verify without
      // limit against an operator who is still being paid.
      if (reservationId && this.opts.policy) {
        await this.opts.policy.commit(reservationId);
        reservationId = null;
      }
      return this.allow(clientVersion, {
        payer: verdict.payer ?? auth.from,
        transaction: "",
        network: this.network,
        asset: this.asset,
        amountAtomic: auth.value,
        resource: ctx.resource,
        settledAt: new Date().toISOString(),
      });
    }

    let settled;
    try {
      settled = await this.facilitator.settle(fReq);
    } catch (e) {
      // The facilitator threw. Unlike the nonce — which stays burned because
      // the payment may still land — the BUDGET is released: money we cannot
      // evidence must not count against an agent's allowance. Worst case the
      // payment does land and the agent got that one call under-charged; the
      // alternative is charging budget for a payment nobody can prove.
      await releaseReservation();
      throw e;
    }
    if (!settled.success) {
      // The nonce stays burned. A settle that errored may STILL land on-chain,
      // so freeing it would reopen replay against a payment that does confirm.
      // An honest retry signs a fresh nonce, so this never blocks a real payer.
      await releaseReservation();
      return fail(settled.errorReason ?? "Settlement failed");
    }

    // A settlement policy, when one is configured, knows the chain and can say
    // things the built-in count cannot: that this tier needs finality rather
    // than confirmation, and — on an optimistic rollup — that no amount of
    // waiting will produce it.
    const verdict = this.opts.settlementPolicy?.forPayment({
      amountAtomic: auth.value,
      decimals: this.assetId.decimals,
      network: this.canonical,
    });

    if (verdict?.unsatisfiable) {
      // Releasing here would mean calling a payment settled that the policy
      // itself says cannot settle by waiting. The money is not lost — the
      // nonce stays burned and the reservation is returned — but the resource
      // is not served on a promise the chain cannot keep.
      await releaseReservation();
      return fail(`Settlement requirement cannot be met on ${this.canonical}: ${verdict.explanation}`);
    }

    const needed = verdict?.confirmations ?? requiredConfirmations(auth.value);
    if (typeof settled.confirmations === "number" && settled.confirmations < needed) {
      await releaseReservation();
      return fail(`Insufficient confirmations (${settled.confirmations}/${needed})`);
    }

    // Settled and confirmed — the spend is real, so the reservation becomes
    // permanent. Committed BEFORE returning: a commit that ran after the
    // response would be a window in which a crash lost the accounting.
    if (reservationId && this.opts.policy) {
      await this.opts.policy.commit(reservationId);
      reservationId = null;
    }

    return this.allow(clientVersion, {
      payer: settled.payer ?? auth.from,
      transaction: settled.transaction ?? "",
      network: settled.network ?? this.network,
      asset: this.asset,
      // v2's `upto` scheme can settle less than the authorized maximum.
      amountAtomic: settled.amount ?? auth.value,
      resource: ctx.resource,
      confirmations: settled.confirmations,
      settledAt: new Date().toISOString(),
    });
  }

  /** Rebuild the requirements the quote was minted with, so the facilitator
   *  checks the payment against the SERVER's terms, not the client's copy. */
  private facilitatorRequest(
    q: MintedQuote,
    payment: { signature: string; authorization: import("./protocol.js").EIP3009Authorization },
    clientVersion: X402Version
  ): FacilitatorRequest {
    const version = this.opts.facilitatorVersion ?? clientVersion;

    if (version === 2) {
      return {
        x402Version: 2,
        paymentPayload: {
          x402Version: 2,
          resource: this.resourceInfo(q),
          accepted: this.toV2(q),
          payload: { signature: payment.signature, authorization: payment.authorization },
        },
        paymentRequirements: this.toV2(q),
      };
    }
    return {
      x402Version: 1,
      paymentPayload: {
        x402Version: 1,
        scheme: "exact",
        network: this.network,
        payload: { signature: payment.signature, authorization: payment.authorization },
        extra: this.extraFor(q),
      },
      paymentRequirements: this.toV1(q),
    };
  }

  /** Answer in the dialect the client spoke — and, harmlessly, the other one too,
   *  so a proxy or SDK expecting either finds its receipt. */
  private async allow(version: X402Version, receipt: SettlementReceipt): Promise<GatewayDecision> {
    await this.opts.onSettled?.(receipt);
    return {
      kind: "allow",
      receipt,
      headers: {
        ...noStoreHeaders,
        [HEADER_V1_RECEIPT]: encodeReceiptV1(receipt),
        [HEADER_V2_RECEIPT]: encodeReceiptV2(receipt),
      },
    };
  }
}

export { LATEST_X402_VERSION };
