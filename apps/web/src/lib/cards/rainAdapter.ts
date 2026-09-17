import type {
  CardAuthorizationDecision,
  CardAuthorizationRequest,
  CardIssuerProviderAdapter,
  CardStatus,
  IssueCardRequest,
  IssuedCard,
} from "@/lib/providers/types";

// ---------------------------------------------------------------------------
// Rain (Signify Holdings, Inc.) card-issuing adapter — SKELETON, FAIL-CLOSED.
//
// WHAT IS VERIFIED, and where it came from.
//
// Rain is real: a Visa/Mastercard issuing platform that settles card
// transactions onchain in stablecoins ($250M Series C, Jan 2026). The following
// were read out of the public `rain-rust-sdk`, which documents itself as
// tracking Rain's OpenAPI specification, and cross-checked by probing hosts:
//
//   base URL (prod)   https://api.raincards.xyz/v1/issuing
//   base URL (dev)    https://api-dev.raincards.xyz/v1/issuing
//   auth header       Api-Key: <key>            (NOT "Authorization: Bearer")
//   card paths        GET    /cards
//                     GET    /cards/{cardId}
//                     PATCH  /cards/{cardId}
//                     GET    /cards/{cardId}/secrets
//                     GET    /cards/{cardId}/processorDetails
//                     GET|PUT /cards/{cardId}/pin
//                     GET    /users/{userId}/cards
//   webhook paths     /webhooks, /webhooks/{webhookId}
//
// WHAT IS NOT VERIFIED, and why nothing below guesses it.
//
// https://docs.rain.xyz redirects to a login page — Rain's API reference is
// behind partner credentials. So the REQUEST AND RESPONSE FIELD SHAPES, and
// critically the WEBHOOK SIGNATURE SCHEME, are not knowable from outside. Every
// method here therefore throws `RainNotConfiguredError` rather than sending a
// request built from a plausible-looking body.
//
// That is the whole point of this file. A card adapter that guesses a field
// name fails at the counter, in front of a customer, with the network holding
// the line. A card adapter that guesses a signature scheme is worse: AGENTS.md
// rule 3 requires HMAC verification over the raw body, and an adapter that
// "verified" a signature it invented would accept anything, letting anyone who
// can reach the endpoint approve spend against a customer's balance.
//
// HOW TO FINISH THIS. When the mNDA is executed and sandbox credentials arrive:
//   1. Read the real schema for card creation, the secrets handle, and the
//      authorisation webhook — including the signature header and the exact
//      bytes it covers.
//   2. Replace each `notConfigured()` with the real call. Keep the Money type
//      at the boundary; the issuer speaks integer minor units and so do we.
//   3. Write the signature test FIRST, with a known-good vector from Rain, and
//      a negative case with a tampered body.
//   4. Only then delete the `unimplemented` reason on CARD_ISSUING_LIVE in
//      lib/flags.ts. Until that day the flag cannot be switched on, which is
//      deliberate: lib/cardIssuer.ts checks `unimplemented` BEFORE `enabled`,
//      so adding RAIN_API_KEY to the environment does not and must not make
//      card issuing live.
// ---------------------------------------------------------------------------

/** Rain's production issuing API. Verified against the public SDK. */
export const RAIN_API_URL_PRODUCTION = "https://api.raincards.xyz/v1/issuing";

/** Rain's development/sandbox issuing API. */
export const RAIN_API_URL_DEVELOPMENT = "https://api-dev.raincards.xyz/v1/issuing";

/** The header Rain authenticates with. Not a bearer token. */
export const RAIN_AUTH_HEADER = "Api-Key";

/** Endpoint paths confirmed present on the issuing API. */
export const RAIN_PATHS = {
  listCards: "/cards",
  card: (cardId: string) => `/cards/${encodeURIComponent(cardId)}`,
  cardSecrets: (cardId: string) => `/cards/${encodeURIComponent(cardId)}/secrets`,
  cardPin: (cardId: string) => `/cards/${encodeURIComponent(cardId)}/pin`,
  cardProcessorDetails: (cardId: string) => `/cards/${encodeURIComponent(cardId)}/processorDetails`,
  userCards: (userId: string) => `/users/${encodeURIComponent(userId)}/cards`,
  webhooks: "/webhooks",
} as const;

/**
 * Thrown by every method until the integration is real.
 *
 * Carries what is missing so an operator reading a log sees the actual blocker
 * — a contract and a schema — rather than a bare "unavailable".
 */
export class RainNotConfiguredError extends Error {
  readonly operation: string;
  readonly blocker: string;
  constructor(operation: string, blocker: string) {
    super(
      `Rain card issuing is not configured: cannot ${operation}. ${blocker} ` +
        `See lib/cards/rainAdapter.ts — the adapter refuses rather than sending a guessed payload.`
    );
    this.name = "RainNotConfiguredError";
    this.operation = operation;
    this.blocker = blocker;
  }
}

const SCHEMA_BLOCKER =
  "Rain's API reference (docs.rain.xyz) requires partner credentials, so the request/response " +
  "schema is unknown. Obtain sandbox access before implementing.";

const SIGNATURE_BLOCKER =
  "Rain's webhook signature scheme is not public. Verifying an inbound authorisation against an " +
  "invented scheme would accept any caller (AGENTS.md rule 3), so this refuses instead.";

function notConfigured(operation: string, blocker: string = SCHEMA_BLOCKER): never {
  throw new RainNotConfiguredError(operation, blocker);
}

/** Resolve the base URL for the current environment. */
export function rainBaseUrl(): string {
  const override = process.env.RAIN_API_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  return process.env.FURLPAY_ENV === "production" ? RAIN_API_URL_PRODUCTION : RAIN_API_URL_DEVELOPMENT;
}

/** True only when BOTH the API key and the webhook secret are present. */
export function rainCredentialsPresent(): boolean {
  return Boolean(process.env.RAIN_API_KEY?.trim() && process.env.RAIN_WEBHOOK_SECRET?.trim());
}

/**
 * The Rain adapter.
 *
 * Constructing it is safe and cheap — it performs no I/O and reads no secrets
 * until a method is called. Every method currently refuses. See the header for
 * what finishing it requires.
 */
export function createRainAdapter(): CardIssuerProviderAdapter {
  return {
    id: "rain",
    kind: "issuing",

    async issueCard(_request: IssueCardRequest): Promise<IssuedCard> {
      return notConfigured("issue a card");
    },

    async getCard(_providerCardRef: string): Promise<IssuedCard> {
      return notConfigured("read a card");
    },

    async setCardStatus(_providerCardRef: string, _status: CardStatus): Promise<IssuedCard> {
      // Note for the implementer: there is no /freeze endpoint. Status changes
      // go through PATCH /cards/{cardId}.
      return notConfigured("change card status");
    },

    async getCardSecretsHandle(_providerCardRef: string) {
      // Note for the implementer: the path is GET /cards/{cardId}/secrets.
      // Whatever it returns must reach the CLIENT, not our server — card
      // credentials transiting our process would put us in PCI scope.
      return notConfigured("obtain a card secrets handle");
    },

    async parseAuthorizationRequest(
      _rawBody: string,
      _headers: Readonly<Record<string, string>>
    ): Promise<CardAuthorizationRequest> {
      return notConfigured("verify an authorization request", SIGNATURE_BLOCKER);
    },

    encodeAuthorizationDecision(
      _request: CardAuthorizationRequest,
      _decision: CardAuthorizationDecision
    ): unknown {
      return notConfigured("encode an authorization decision");
    },
  };
}

/**
 * The adapter, or null when Rain is not configured.
 *
 * Mirrors `x402Settler.defaultSettler()`: returning null lets the caller fail
 * closed with a 503 that names the gap, instead of constructing something that
 * throws deep inside a request.
 */
export function rainAdapter(): CardIssuerProviderAdapter | null {
  if (!rainCredentialsPresent()) return null;
  return createRainAdapter();
}
