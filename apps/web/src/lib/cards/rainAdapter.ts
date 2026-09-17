import type {
  CardAuthorizationDecision,
  CardAuthorizationRequest,
  CardIssuerProviderAdapter,
  CardSecrets,
  CardSpendControls,
  CardStatus,
  IssueCardRequest,
  IssuedCard,
} from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// Rain (Signify Holdings, Inc.) card-issuing adapter.
//
// Rain is a Visa/Mastercard issuing platform that settles card transactions
// onchain in stablecoins. This adapter is split by what could be VERIFIED,
// because https://docs.rain.xyz redirects to a partner login and the API
// reference is not public.
//
// Everything below came out of Rain's public `rain-rust-sdk`, which documents
// itself as tracking their OpenAPI specification, cross-checked by probing
// hosts. Where the SDK is silent, this file refuses rather than guessing.
//
//   base URL (prod)  https://api.raincards.xyz/v1/issuing
//   base URL (dev)   https://api-dev.raincards.xyz/v1/issuing
//   auth header      Api-Key: <key>              NOT "Authorization: Bearer"
//   wire casing      camelCase                   NOT snake_case
//
// WHAT THE CIRCULATING INTEGRATION GUIDES GET WRONG. They are worth naming
// because they look authoritative and every one of these would fail in
// production, several of them silently:
//
//   claimed                        actual
//   api.rain.xyz/v1                api.raincards.xyz/v1/issuing  (the former 404s)
//   Authorization: Bearer <key>    Api-Key: <key>
//   POST /cardholders              cardholders are /users
//   POST /cards/{id}/freeze        PATCH /cards/{id} with status
//   POST /cards/{id}/reveal-token  GET /cards/{id}/secrets
//   spending_controls.spend_limit  limit: { amount, frequency }
//   spend_limit_duration           frequency: per24HourPeriod | perAuthorization | ...
//   allowed_mcc_categories         not a field on card creation at all
//   status "frozen"                "locked"
//
// WHAT IS STILL UNVERIFIED, and therefore still refuses:
//
//   The JIT AUTHORIZATION WEBHOOK signature scheme. Rain's /webhooks endpoint
//   is a delivery LOG (list past deliveries), not a verification helper, and
//   the receiving-side signature format is only in the gated docs. AGENTS.md
//   rule 3 requires HMAC verification over the raw body; an adapter that
//   "verified" an invented scheme would accept any caller who can reach the
//   endpoint and approve spend against a customer's balance. So
//   parseAuthorizationRequest throws until the real scheme is known.
//
//   MCC allowlists. Rain DOES support them — their Agent Control Layer
//   documents controls over "acceptable merchant category codes, approved
//   merchants or payment recipients", transaction amounts and frequency,
//   enforced at issuance rather than retroactively. But the field is not in the
//   `CreateCardRequest` shape the public SDK exposes, so the wire name is
//   unknown. issueCard therefore refuses a request carrying MCC limits rather
//   than silently dropping them: a card that does not enforce the restriction
//   its caller asked for spends anywhere, which is worse than an error.
//
// AND THE THING THIS FILE MUST NOT DO. Nothing here can switch card issuing
// on. lib/cardIssuer.ts gates every card route on CARD_ISSUING_LIVE, whose
// `unimplemented` reason flagState() checks BEFORE `enabled`. Provisioning
// RAIN_API_KEY does not and must not flip that gate; it opens the day someone
// deletes the reason, and on that day they must actually have an issuer
// contract, a settlement account, and a verified webhook scheme.
// ---------------------------------------------------------------------------

// The `servers` block of Rain's Issuing API OpenAPI document (v1.3.0). The
// server is /v1 and the issuing group is a PATH prefix — not part of the base.
// That distinction is not cosmetic: Rain's API also exposes payments,
// transfers, quotes and rewards groups directly under /v1, so folding
// "/issuing" into the base URL would silently misroute every one of them the
// day somebody adds a non-card call.
export const RAIN_API_URL_PRODUCTION = "https://api.raincards.xyz/v1";
export const RAIN_API_URL_DEVELOPMENT = "https://api-dev.raincards.xyz/v1";
export const RAIN_AUTH_HEADER = "Api-Key";

export const RAIN_PATHS = {
  listCards: "/issuing/cards",
  card: (cardId: string) => `/issuing/cards/${encodeURIComponent(cardId)}`,
  cardSecrets: (cardId: string) => `/issuing/cards/${encodeURIComponent(cardId)}/secrets`,
  cardPin: (cardId: string) => `/issuing/cards/${encodeURIComponent(cardId)}/pin`,
  cardProcessorDetails: (cardId: string) => `/issuing/cards/${encodeURIComponent(cardId)}/processorDetails`,
  userCards: (userId: string) => `/issuing/users/${encodeURIComponent(userId)}/cards`,
  balances: "/issuing/balances",
  webhooks: "/issuing/webhooks",
} as const;

/**
 * Documented rate limits, recorded so a caller can pace itself rather than
 * discover them as 429s in production. Tenant-level limits are shared across an
 * organisation AND its subtenants; these per-endpoint ones are keyed by IP and
 * apply on top.
 */
export const RAIN_RATE_LIMITS = {
  /** Unauthenticated, per IP, per minute. */
  unauthenticatedPerMinute: 1000,
  /** POST card creation, per IP, per hour. */
  createCardPerHour: 3000,
  /** Scoped (agent) card creation, per IP, per minute. */
  createScopedCardPerMinute: 60,
  /** Signature endpoints, per IP, per second. */
  signaturesPerSecond: 1,
  /** Blank-card creation, per TENANT, per second. */
  blankCardsPerSecondPerTenant: 2,
} as const;

/** Thrown on 429 so a caller can back off on Rain's own schedule. */
export class RainRateLimitedError extends Error {
  /** Seconds to wait, from `Retry-After` or `X-RateLimit-Reset`. Undefined when
   *  Rain sent neither — back off exponentially in that case. */
  readonly retryAfterSeconds: number | undefined;
  constructor(path: string, retryAfterSeconds: number | undefined) {
    super(
      `Rain rate limit hit on ${path}` +
        (retryAfterSeconds === undefined ? "" : ` — retry in ${retryAfterSeconds}s`)
    );
    this.name = "RainRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** Rain's card states. Ours are in providers/types.ts; this is the mapping. */
export type RainCardStatus = "notActivated" | "active" | "locked" | "canceled";

/** Rain's limit windows. Note "perAuthorization" is the single-use analogue. */
export type RainLimitFrequency =
  | "per24HourPeriod"
  | "per7DayPeriod"
  | "per30DayPeriod"
  | "perYearPeriod"
  | "allTime"
  | "perAuthorization";

export class RainNotConfiguredError extends Error {
  readonly operation: string;
  readonly blocker: string;
  constructor(operation: string, blocker: string) {
    super(`Rain card issuing cannot ${operation}. ${blocker}`);
    this.name = "RainNotConfiguredError";
    this.operation = operation;
    this.blocker = blocker;
  }
}

export class RainApiError extends Error {
  readonly status: number;
  constructor(status: number, path: string, detail: string) {
    // The body is NOT interpolated: an issuer error can echo card data back.
    super(`Rain API ${status} on ${path}: ${detail}`);
    this.name = "RainApiError";
    this.status = status;
  }
}

const SIGNATURE_BLOCKER =
  "Rain's inbound webhook signature scheme is not public — /webhooks is a delivery log, not a " +
  "verification helper. Verifying against an invented scheme would accept any caller " +
  "(AGENTS.md rule 3), so this refuses.";

/** Our status vocabulary -> Rain's. `pending` maps to their pre-activation state. */
export function toRainStatus(status: CardStatus): RainCardStatus {
  switch (status) {
    case "active":
      return "active";
    case "frozen":
      return "locked";
    case "closed":
      return "canceled";
    case "pending":
      return "notActivated";
  }
}

/** Rain's status vocabulary -> ours. */
export function fromRainStatus(status: string): CardStatus {
  switch (status) {
    case "active":
      return "active";
    case "locked":
      return "frozen";
    case "canceled":
      return "closed";
    case "notActivated":
      return "pending";
    default:
      // An unknown state is not "active". Treat it as frozen — the safe reading
      // — rather than assuming a card we do not understand is spendable.
      return "frozen";
  }
}

/** Our spend-control window -> Rain's frequency. */
export function toRainFrequency(
  window: NonNullable<CardSpendControls["limitWindow"]>,
  singleUse: boolean
): RainLimitFrequency {
  if (singleUse || window === "transaction") return "perAuthorization";
  switch (window) {
    case "daily":
      return "per24HourPeriod";
    case "weekly":
      return "per7DayPeriod";
    case "monthly":
      return "per30DayPeriod";
  }
}

export function rainBaseUrl(): string {
  const override = process.env.RAIN_API_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return process.env.FURLPAY_ENV === "production" ? RAIN_API_URL_PRODUCTION : RAIN_API_URL_DEVELOPMENT;
}

export function rainCredentialsPresent(): boolean {
  return Boolean(process.env.RAIN_API_KEY?.trim() && process.env.RAIN_WEBHOOK_SECRET?.trim());
}

interface RainEncrypted {
  iv: string;
  data: string;
}

interface RainCard {
  id: string;
  userId: string;
  companyId?: string;
  status: string;
  limit?: { amount: number; frequency: string };
  expirationMonth: string;
  expirationYear: string;
  last4?: string;
  type?: string;
  tokenWallets?: string[];
}

/** Rain's card -> ours. Missing required fields throw rather than defaulting. */
export function mapRainCard(card: RainCard): IssuedCard {
  const expMonth = Number(card.expirationMonth);
  const expYear = Number(card.expirationYear);
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
    throw new RainApiError(200, "card", "expirationMonth was not a month");
  }
  if (!Number.isInteger(expYear)) {
    throw new RainApiError(200, "card", "expirationYear was not a year");
  }
  return {
    providerCardRef: card.id,
    status: fromRainStatus(card.status),
    // Never fabricate a last4. An absent one is reported as empty, not invented
    // — a plausible-looking wrong last4 makes a support call unresolvable.
    last4: typeof card.last4 === "string" ? card.last4 : "",
    expMonth,
    expYear,
    network: "Visa",
    formFactor: card.type === "physical" ? "physical" : "virtual",
  };
}

async function rainRequest<T>(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown
): Promise<T> {
  const apiKey = process.env.RAIN_API_KEY?.trim();
  if (!apiKey) {
    throw new RainNotConfiguredError("reach the API", "RAIN_API_KEY is not set.");
  }

  const res = await fetch(`${rainBaseUrl()}${path}`, {
    method,
    headers: {
      [RAIN_AUTH_HEADER]: apiKey,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  // 429 is not a generic failure: Rain tells you when to come back, and a
  // caller that retries immediately just burns the same bucket. Card creation
  // is capped at 3,000/hour and scoped (agent) cards at 60/minute, both keyed
  // by IP, so an agent workload will meet this in normal operation.
  if (res.status === 429) {
    // Retry-After (seconds) on blank-cards; X-RateLimit-Reset (unix seconds)
    // elsewhere. Neither is guaranteed, so undefined means "back off yourself".
    const retryAfter = Number(res.headers.get("retry-after"));
    const resetAt = Number(res.headers.get("x-ratelimit-reset"));
    const seconds = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter
      : Number.isFinite(resetAt) && resetAt > 0
        ? Math.max(0, Math.ceil(resetAt - Date.now() / 1000))
        : undefined;
    throw new RainRateLimitedError(path, seconds);
  }

  if (!res.ok) {
    // Rain's documented error shape is { statusCode, error, message }. The
    // `error` type name is safe to surface; `message` is NOT interpolated,
    // because an issuer error can echo card data back into it.
    let errorType = res.status >= 500 ? "issuer error" : "request rejected";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body?.error === "string" && body.error.length <= 64) errorType = body.error;
    } catch {
      // Non-JSON body. The status line is enough.
    }
    throw new RainApiError(res.status, path, errorType);
  }

  const parsed = (await res.json()) as unknown;
  if (parsed === null || typeof parsed !== "object") {
    throw new RainApiError(res.status, path, "response was not a JSON object");
  }
  return parsed as T;
}

export function createRainAdapter(): CardIssuerProviderAdapter {
  return {
    id: "rain",
    kind: "issuing",

    async issueCard(request: IssueCardRequest): Promise<IssuedCard> {
      // Rain's CreateCardRequest carries no MCC field. Dropping a caller's MCC
      // restriction silently would issue a card that spends anywhere — refuse.
      if (request.controls.allowedMccs !== undefined) {
        throw new RainNotConfiguredError(
          "issue a card with MCC restrictions",
          "Rain supports MCC controls (Agent Control Layer), but the field is absent from the " +
            "card-creation schema in their public SDK, so its wire name is unknown. Enforce the " +
            "restriction at JIT authorization time, or confirm the real field before relying on it."
        );
      }

      const limit = request.controls.limit;
      const body: Record<string, unknown> = {
        userId: request.holderRef,
        ...(limit
          ? {
              limit: {
                // Integer minor units both sides. No float ever enters this.
                amount: Number(limit.minor),
                frequency: toRainFrequency(request.controls.limitWindow ?? "monthly", request.singleUse),
              },
            }
          : {}),
      };

      const card = await rainRequest<RainCard>("POST", RAIN_PATHS.listCards, body);
      return mapRainCard(card);
    },

    async getCard(providerCardRef: string): Promise<IssuedCard> {
      const card = await rainRequest<RainCard>("GET", RAIN_PATHS.card(providerCardRef));
      return mapRainCard(card);
    },

    async setCardStatus(providerCardRef: string, status: CardStatus): Promise<IssuedCard> {
      // There is no /freeze endpoint; status is a PATCH on the card.
      const card = await rainRequest<RainCard>("PATCH", RAIN_PATHS.card(providerCardRef), {
        status: toRainStatus(status),
      });
      return mapRainCard(card);
    },

    async getCardSecrets(providerCardRef: string): Promise<CardSecrets> {
      const secrets = await rainRequest<{
        encryptedPan: RainEncrypted;
        encryptedCvc: RainEncrypted;
      }>("GET", RAIN_PATHS.cardSecrets(providerCardRef));

      if (!secrets.encryptedPan?.data || !secrets.encryptedCvc?.data) {
        throw new RainApiError(200, "secrets", "response was missing encrypted card data");
      }
      // Returned as ciphertext, deliberately. The plaintext never exists here.
      return {
        encryptedPan: { iv: secrets.encryptedPan.iv, data: secrets.encryptedPan.data },
        encryptedCvc: { iv: secrets.encryptedCvc.iv, data: secrets.encryptedCvc.data },
      };
    },

    async parseAuthorizationRequest(
      _rawBody: string,
      _headers: Readonly<Record<string, string>>
    ): Promise<CardAuthorizationRequest> {
      throw new RainNotConfiguredError("verify an authorization request", SIGNATURE_BLOCKER);
    },

    encodeAuthorizationDecision(
      _request: CardAuthorizationRequest,
      _decision: CardAuthorizationDecision
    ): unknown {
      throw new RainNotConfiguredError(
        "encode an authorization decision",
        "The JIT response schema is only in Rain's gated documentation."
      );
    },
  };
}

export function rainAdapter(): CardIssuerProviderAdapter | null {
  if (!rainCredentialsPresent()) return null;
  return createRainAdapter();
}
