import crypto from "crypto";
import type {
  CardAuthorizationDecision,
  CardAuthorizationRequest,
  CardIssuerProviderAdapter,
  CardSecrets,
  CardStatus,
  IssueCardRequest,
  IssuedCard,
} from "@/lib/providers/types";
import { Money, requireAsset } from "@/lib/money/money";

// ---------------------------------------------------------------------------
// The local card issuer simulator.
//
// WHY IT IMPLEMENTS THE SAME PORT. Before this, the card routes held their own
// local state and there was no seam — so the day a real issuer arrived, every
// route would have needed rewriting, and no route had ever exercised the shape
// the real adapter would present. Development now runs through
// CardIssuerProviderAdapter exactly as Rain will, which means the wiring is
// tested long before the credentials exist.
//
// WHY IT IS NOT REACHABLE IN PRODUCTION. `cardSimulationAllowed()` is false
// when NODE_ENV is production AND false once a live issuer flag is on, so a
// developer testing the real path never silently gets this one. That check
// lives in lib/cardIssuer.ts; this file does not re-implement it, because two
// copies of a safety check is one copy too many.
//
// WHY EVERYTHING IT RETURNS IS OBVIOUSLY FAKE. A simulator whose output could
// be mistaken for real output is worse than no simulator. So:
//   - the PAN is 4242…, the industry's universally-recognised test number
//   - `encryptedPan`/`encryptedCvc` carry a literal marker, not ciphertext
//   - card ids are prefixed `sim_`
// If any of that reaches a screen, a log or a partner, it reads as a fixture
// at a glance rather than a card number somebody has to go and check.
// ---------------------------------------------------------------------------

interface SimulatedCard {
  id: string;
  holderRef: string;
  status: CardStatus;
  last4: string;
  expMonth: number;
  expYear: number;
  formFactor: "virtual" | "physical";
}

/** Process-local. Restarting the dev server clears it, which is correct: a
 *  simulator that survived a restart would start to feel like a database. */
const cards = new Map<string, SimulatedCard>();

/** Exposed for tests so one case cannot leak into the next. */
export function resetSimulatedCards(): void {
  cards.clear();
}

function notFound(ref: string): never {
  throw new Error(`Simulated card not found: ${ref}`);
}

export function createSimulatedCardIssuerAdapter(): CardIssuerProviderAdapter {
  return {
    id: "simulated",
    kind: "issuing",

    async issueCard(request: IssueCardRequest): Promise<IssuedCard> {
      // Reject what a real issuer would reject, so the simulator does not teach
      // the calling code habits that break on the real adapter.
      if (request.controls.allowedMccs?.length === 0) {
        throw new Error("allowedMccs was empty — that permits no merchant at all. Omit it for unrestricted.");
      }

      const now = new Date();
      const card: SimulatedCard = {
        id: `sim_${crypto.randomUUID()}`,
        holderRef: request.holderRef,
        // Physical cards arrive inactive, as they do in reality.
        status: request.formFactor === "physical" ? "pending" : "active",
        last4: "4242",
        expMonth: now.getUTCMonth() + 1,
        expYear: now.getUTCFullYear() + 3,
        formFactor: request.formFactor,
      };
      cards.set(card.id, card);
      return toIssued(card);
    },

    async getCard(providerCardRef: string): Promise<IssuedCard> {
      const card = cards.get(providerCardRef);
      return card ? toIssued(card) : notFound(providerCardRef);
    },

    async setCardStatus(providerCardRef: string, status: CardStatus): Promise<IssuedCard> {
      const card = cards.get(providerCardRef);
      if (!card) notFound(providerCardRef);
      // A closed card is terminal at every real issuer. Model that, or the
      // calling code learns it can reopen one.
      if (card.status === "closed" && status !== "closed") {
        throw new Error("A closed card cannot be reopened. Issue a replacement.");
      }
      card.status = status;
      return toIssued(card);
    },

    async getCardSecrets(providerCardRef: string): Promise<CardSecrets> {
      if (!cards.has(providerCardRef)) notFound(providerCardRef);
      // Deliberately not ciphertext and deliberately self-describing: if this
      // ever reaches a screen or a log it reads as a fixture, not a card.
      const marker = (label: string) => ({
        iv: Buffer.from("furlpay-simulated-iv").toString("base64"),
        data: Buffer.from(`furlpay-simulated-${label}:${providerCardRef}`).toString("base64"),
      });
      return { encryptedPan: marker("pan"), encryptedCvc: marker("cvc") };
    },

    async parseAuthorizationRequest(
      rawBody: string,
      _headers: Readonly<Record<string, string>>
    ): Promise<CardAuthorizationRequest> {
      // The simulator parses its own shape. It does NOT skip verification and
      // pretend to have verified — the caller is responsible for the HMAC on
      // /api/webhooks/card-auth, and this adapter never claims otherwise.
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed === null || typeof parsed !== "object") throw new Error("body was not an object");
      const p = parsed as Record<string, unknown>;

      const amountMinor = p.amountMinor;
      if (typeof amountMinor !== "string" && typeof amountMinor !== "number") {
        throw new Error("amountMinor is required, in integer minor units");
      }
      const merchant = (p.merchant ?? {}) as Record<string, unknown>;

      return {
        providerAuthRef: String(p.id ?? `sim_auth_${crypto.randomUUID()}`),
        providerCardRef: String(p.cardId ?? ""),
        amount: Money.ofMinor(BigInt(amountMinor), requireAsset("USD")),
        merchant: {
          name: String(merchant.name ?? "Simulated merchant"),
          mcc: String(merchant.mcc ?? ""),
          city: typeof merchant.city === "string" ? merchant.city : undefined,
          country: typeof merchant.country === "string" ? merchant.country : undefined,
        },
      };
    },

    encodeAuthorizationDecision(
      request: CardAuthorizationRequest,
      decision: CardAuthorizationDecision
    ): unknown {
      return decision.approve
        ? { approved: true, authorizationId: request.providerAuthRef, simulated: true }
        : { approved: false, declineReason: decision.reason, authorizationId: request.providerAuthRef, simulated: true };
    },
  };
}

function toIssued(card: SimulatedCard): IssuedCard {
  return {
    providerCardRef: card.id,
    status: card.status,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    network: "Visa",
    formFactor: card.formFactor,
  };
}
