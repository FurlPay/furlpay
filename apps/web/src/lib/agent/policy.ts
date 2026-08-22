// ---------------------------------------------------------------------------
// The trading policy engine.
//
// WHAT THIS IS ACTUALLY DEFENDING AGAINST. Not a rogue model. The realistic
// failure is mundane: a user asks an agent to "rebalance towards tech", the
// model's arithmetic is off by a factor of ten, and nothing between the
// intention and the venue notices. Prompt injection through a fetched web page
// is the same shape with worse intent — in both cases the model produces a
// well-formed, plausible instruction that nobody authorised.
//
// So the engine does not try to judge whether an intent is *reasonable*. It
// cannot; that is a question about the user's finances and beliefs. It answers
// a much narrower question that it CAN answer correctly: is this action inside
// the envelope the user agreed to in advance?
//
// THE THREE PROPERTIES THAT MAKE IT WORTH HAVING:
//
//   1. DEFAULT DENY. A user with no policy can trade nothing through an agent.
//      A default-allow engine protects nobody, because the accounts that most
//      need protecting are the ones nobody configured.
//
//   2. THE ENGINE CANNOT BE ADDRESSED BY THE MODEL. Its inputs are a
//      structured action and a stored policy. There is no field the model
//      writes that the engine reads as instruction — no "urgency", no
//      "confidence", no free text that could carry "ignore previous limits".
//
//   3. APPROVAL IS A SEPARATE EVENT. An agent producing a decision and an
//      agent obtaining consent must not be the same step, or the consent is
//      just another model output. Anything above the auto-execute threshold
//      returns a preview and stops.
//
// SPENDING LIMITS ARE ENFORCED ON A LEDGER, NOT A COUNTER. `dailySpent` is
// supplied by the caller from actual executed orders. A counter the engine
// increments itself would reset on redeploy, drift on a failed execution, and
// be invisible to reconciliation.
// ---------------------------------------------------------------------------

export type AgentAction =
  | { kind: "buy"; symbol: string; notionalUsd: number }
  | { kind: "sell"; symbol: string; notionalUsd: number }
  | { kind: "cancel"; clientOrderId: string }
  | { kind: "create_dca"; symbol: string; notionalUsd: number; cadence: "daily" | "weekly" | "monthly" }
  | { kind: "read" };

export interface TradingPolicy {
  /** Master switch. False means the agent may read and nothing else. */
  tradingEnabled: boolean;
  /** Largest single order, USD. */
  maxTradeAmountUsd: number;
  /** Cumulative agent-initiated notional per UTC day, USD. */
  maxDailyAmountUsd: number;
  /** Symbols the agent may trade. EMPTY MEANS NONE — never "all". */
  allowedSymbols: string[];
  /** Symbols the agent may never trade, whatever the allow-list says. */
  blockedSymbols: string[];
  /** Above this, a human must approve even when everything else passes. */
  requireApprovalAboveUsd: number;
  /** Above this, approval must additionally be a biometric/step-up event. */
  requireBiometricAboveUsd: number;
  /** Orders per UTC day, regardless of size. Bounds a loop that is individually
   *  compliant and collectively ruinous in fees. */
  maxOrdersPerDay: number;
}

/**
 * The policy a user has before they configure one.
 *
 * Reads are permitted — an agent that can see a portfolio is useful and moves
 * nothing. Everything else is zero. A user who has never opened the settings
 * screen has not consented to autonomous trading, and inferring consent from
 * silence is the thing this file exists to prevent.
 */
export const DEFAULT_POLICY: TradingPolicy = {
  tradingEnabled: false,
  maxTradeAmountUsd: 0,
  maxDailyAmountUsd: 0,
  allowedSymbols: [],
  blockedSymbols: [],
  requireApprovalAboveUsd: 0,
  requireBiometricAboveUsd: 0,
  maxOrdersPerDay: 0,
};

export type PolicyDecision =
  | { verdict: "allow"; detail: string }
  | { verdict: "require_approval"; detail: string; stepUp: "confirm" | "biometric" }
  | { verdict: "deny"; code: PolicyDenial; detail: string };

export type PolicyDenial =
  | "trading_disabled"
  | "capability_off"
  | "symbol_not_allowed"
  | "symbol_blocked"
  | "exceeds_trade_limit"
  | "exceeds_daily_limit"
  | "exceeds_order_count"
  | "invalid_action";

export interface PolicyContext {
  policy: TradingPolicy;
  /** Agent-initiated notional already executed today, from real orders. */
  dailySpentUsd: number;
  /** Agent-initiated orders already placed today. */
  dailyOrderCount: number;
  /** Whether AI_TRADING_LIVE is on. Passed in rather than read here so this
   *  module stays pure. */
  capabilityEnabled: boolean;
}

/**
 * Evaluate one action.
 *
 * Order of checks matters: the cheapest and most absolute come first, so a
 * denied action is denied for the most fundamental available reason. A user
 * told "exceeds your daily limit" when trading is disabled entirely would go
 * and raise their daily limit.
 */
export function evaluate(action: AgentAction, ctx: PolicyContext): PolicyDecision {
  // Reads move nothing and are always permitted.
  if (action.kind === "read") {
    return { verdict: "allow", detail: "Read-only action." };
  }

  if (!ctx.capabilityEnabled) {
    return {
      verdict: "deny",
      code: "capability_off",
      detail: "Agent trading is not enabled on this deployment.",
    };
  }

  if (!ctx.policy.tradingEnabled) {
    return {
      verdict: "deny",
      code: "trading_disabled",
      detail: "You have not enabled agent trading for this account.",
    };
  }

  // Cancelling reduces exposure and cannot spend money. Permitted without a
  // size check — a policy that blocks cancellation is a policy that traps a
  // user in a position.
  if (action.kind === "cancel") {
    return { verdict: "allow", detail: "Cancellation reduces exposure." };
  }

  const symbol = action.symbol.toUpperCase();
  const amount = action.notionalUsd;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { verdict: "deny", code: "invalid_action", detail: "Order amount must be a positive number." };
  }

  // Block-list beats allow-list, always. A symbol on both lists is denied —
  // the safer reading of a contradictory configuration.
  if (ctx.policy.blockedSymbols.map((s) => s.toUpperCase()).includes(symbol)) {
    return { verdict: "deny", code: "symbol_blocked", detail: `${symbol} is on your blocked list.` };
  }

  // Empty allow-list denies everything. Never "empty means all".
  if (!ctx.policy.allowedSymbols.map((s) => s.toUpperCase()).includes(symbol)) {
    return {
      verdict: "deny",
      code: "symbol_not_allowed",
      detail:
        ctx.policy.allowedSymbols.length === 0
          ? "No symbols are approved for agent trading on this account."
          : `${symbol} is not on your approved list.`,
    };
  }

  if (amount > ctx.policy.maxTradeAmountUsd) {
    return {
      verdict: "deny",
      code: "exceeds_trade_limit",
      detail: `$${amount.toFixed(2)} exceeds your per-trade limit of $${ctx.policy.maxTradeAmountUsd.toFixed(2)}.`,
    };
  }

  if (ctx.dailyOrderCount >= ctx.policy.maxOrdersPerDay) {
    return {
      verdict: "deny",
      code: "exceeds_order_count",
      detail: `You have reached your limit of ${ctx.policy.maxOrdersPerDay} agent orders today.`,
    };
  }

  // A SELL is checked against the daily budget too. It is tempting to exempt
  // sells because they raise cash — but an agent that can liquidate a portfolio
  // without limit is exactly as dangerous as one that can spend without limit.
  if (ctx.dailySpentUsd + amount > ctx.policy.maxDailyAmountUsd) {
    const remaining = Math.max(0, ctx.policy.maxDailyAmountUsd - ctx.dailySpentUsd);
    return {
      verdict: "deny",
      code: "exceeds_daily_limit",
      detail: `This would exceed today's agent limit. $${remaining.toFixed(2)} of $${ctx.policy.maxDailyAmountUsd.toFixed(2)} remains.`,
    };
  }

  // Within the envelope. Now: may it execute unattended, or must a human say
  // yes? Biometric is checked first — it is the stronger requirement.
  if (amount > ctx.policy.requireBiometricAboveUsd) {
    return {
      verdict: "require_approval",
      stepUp: "biometric",
      detail: `$${amount.toFixed(2)} is above your biometric-approval threshold.`,
    };
  }
  if (amount > ctx.policy.requireApprovalAboveUsd) {
    return {
      verdict: "require_approval",
      stepUp: "confirm",
      detail: `$${amount.toFixed(2)} is above your unattended-execution threshold.`,
    };
  }

  return { verdict: "allow", detail: "Within your agent trading policy." };
}

/**
 * A trade preview — what the user approves.
 *
 * Deliberately NOT generated by the model. Every figure is computed from the
 * structured action and real market data, so what the user reads is what will
 * be submitted. A model-written summary can describe a different trade from the
 * one in the payload, and the user would have no way to tell.
 */
export interface TradePreview {
  action: AgentAction;
  symbol: string;
  side: "buy" | "sell";
  notionalUsd: number;
  /** Null when no fresh price is available — and then the preview cannot be
   *  approved, because there is nothing to approve against. */
  estimatedPrice: number | null;
  estimatedQty: number | null;
  priceSource: string | null;
  priceAgeSeconds: number | null;
  decision: PolicyDecision;
  /** A short-lived token the approval endpoint requires, binding the approval
   *  to THIS preview. Without it an approval is a blank cheque for any trade. */
  previewId: string;
  expiresAt: string;
}

/** How long a preview may be approved for. Long enough to read, short enough
 *  that the quote behind it is still meaningful. */
export const PREVIEW_TTL_SECONDS = 120;

/** Is this preview still approvable? */
export function previewIsValid(preview: TradePreview, now = Date.now()): boolean {
  return Date.parse(preview.expiresAt) > now;
}

/**
 * Merge a stored partial policy over the defaults.
 *
 * Every field is validated and clamped rather than trusted. A stored policy is
 * user-writable state, and a negative or NaN limit must not become an infinite
 * one — the arithmetic `amount > NaN` is false, which would silently pass every
 * size check.
 */
export function normalizePolicy(stored: Partial<TradingPolicy> | null | undefined): TradingPolicy {
  if (!stored) return { ...DEFAULT_POLICY };
  const money = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, 1_000_000) : fallback;
  const symbols = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((s): s is string => typeof s === "string" && /^[A-Z0-9.\-]{1,10}$/i.test(s))
          .map((s) => s.toUpperCase())
          .slice(0, 100)
      : [];

  return {
    tradingEnabled: stored.tradingEnabled === true,
    maxTradeAmountUsd: money(stored.maxTradeAmountUsd, 0),
    maxDailyAmountUsd: money(stored.maxDailyAmountUsd, 0),
    allowedSymbols: symbols(stored.allowedSymbols),
    blockedSymbols: symbols(stored.blockedSymbols),
    requireApprovalAboveUsd: money(stored.requireApprovalAboveUsd, 0),
    requireBiometricAboveUsd: money(stored.requireBiometricAboveUsd, 0),
    maxOrdersPerDay:
      typeof stored.maxOrdersPerDay === "number" && Number.isFinite(stored.maxOrdersPerDay) && stored.maxOrdersPerDay >= 0
        ? Math.min(Math.floor(stored.maxOrdersPerDay), 1000)
        : 0,
  };
}
