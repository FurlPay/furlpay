import type { BoardingPass } from "@/lib/travel/boardingPass";

// ---------------------------------------------------------------------------
// Wallet pass CONTENT — platform-neutral, and the only part of pass support
// that can be built without credentials.
//
// WHAT THIS IS NOT. It does not produce a `.pkpass`, and it does not call
// Google. Both are blocked on credentials this project does not have:
//
//   Apple  — signing a .pkpass requires a Pass Type ID certificate issued from
//            an Apple Developer account, countersigned by Apple's WWDR
//            intermediate. native-app/eas.json records that no Apple Developer
//            account exists ("BLOCKED ON AN APPLE DEVELOPER ACCOUNT"), so this
//            is the SAME blocker as the iOS release, not a new one. The certs
//            also expire every 398 days, which is a renewal obligation to plan
//            for rather than discover.
//   Google — requires a Google Wallet Issuer ID and a service-account key.
//            Neither is declared in apps/web/.env.example.
//
// So this module stops at a content model: one description of what a pass says,
// which a signer can later render into Apple's `pass.json` or Google's
// `genericObject`. Keeping it separate is not ceremony — the rendering is
// mechanical, and everything that can actually be WRONG lives here: what is
// disclosed, which instant a countdown derives from, and which timezone a
// printed time belongs to.
//
// THE DISCLOSURE PROBLEM, which is the reason this file leads with a redactor.
//
// A wallet pass is not a screen inside the app. It is:
//   * visible on a LOCK SCREEN, to anyone holding the phone
//   * surfaced automatically by proximity or time, without being opened
//   * a FILE — a .pkpass can be AirDropped, mailed, or backed up, so its
//     contents outlive the device
//
// FurlPay already ships Discreet Mode (native-app/lib/privacy/
// balanceVisibility.ts) precisely so a user can hide their balance in public.
// A pass that prints portfolio value on the lock screen contradicts a feature
// the product already has, and no amount of care at one call site prevents the
// next one. So the rule is enforced here, over the finished content, rather
// than trusted to whoever builds the next pass type.
// ---------------------------------------------------------------------------

/** A single label/value row on a pass. */
export interface PassField {
  key: string;
  label: string;
  value: string;
  /**
   * Shown by the OS when this value changes on an updated pass.
   *
   * `%@` is substituted with the new value by both platforms. Only set it where
   * a change is worth interrupting someone for — a gate change is; a re-render
   * of the same data is not.
   */
  changeMessage?: string;
}

/** Where a pass should surface itself. */
export interface PassRelevance {
  /**
   * The instant this pass becomes worth showing, ISO-8601 with offset.
   *
   * ABSOLUTE, never a wall-clock string. A pass whose relevance is stored as
   * "14:30" surfaces at 14:30 in whatever zone the phone is in, which for a
   * traveller is the one place it is guaranteed to be wrong.
   */
  at?: string;
  /** Geofences. Empty when real coordinates are unavailable — see below. */
  locations: Array<{ latitude: number; longitude: number; relevantText: string }>;
}

export type PassKind = "boarding" | "hotelReservation";

/** Everything a pass says, before a platform renders it. */
export interface PassContent {
  kind: PassKind;
  /** Stable per pass, and the key a platform update is addressed to. */
  serial: string;
  organizationName: string;
  description: string;
  headerFields: PassField[];
  primaryFields: PassField[];
  secondaryFields: PassField[];
  auxiliaryFields: PassField[];
  /** Shown only when the pass is flipped over. Still not private — see redact. */
  backFields: PassField[];
  barcode: { format: "qr" | "aztec" | "pdf417"; message: string; altText?: string };
  relevance: PassRelevance;
}

// --- the redactor -----------------------------------------------------------

/**
 * Patterns that must never appear in pass content.
 *
 * Each is here because a wallet pass is a lock-screen surface and a shareable
 * file, not because the value is secret in general — a receive address is
 * public by construction, and is still not something to print somewhere it can
 * be photographed off a stranger's phone and reused.
 */
const FORBIDDEN: Array<{ name: string; test: RegExp; why: string }> = [
  {
    name: "EVM address",
    test: /\b0x[0-9a-fA-F]{40}\b/,
    why: "a full receive address on a lock screen can be photographed and reused; show a truncated form",
  },
  {
    name: "Solana address",
    // Base58, 32-44 chars. Anchored on word boundaries to avoid matching
    // ordinary prose, and length-bounded so IATA codes and flight numbers pass.
    test: /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
    why: "same as an EVM address: public, but not lock-screen material",
  },
  {
    name: "E.164 phone number",
    test: /\+\d{7,15}\b/,
    why: "a PayNow/UPI proxy is a phone number, and a pass is a shareable file",
  },
  {
    name: "PAN-like digit run",
    test: /\b\d{13,19}\b/,
    why: "13-19 consecutive digits reads as a card number whether or not it is one",
  },
  {
    name: "email address",
    test: /\b[^\s@]+@[^\s@.]+\.[^\s@]{2,}\b/,
    why: "identifies the holder to anyone who picks the phone up",
  },
];

/**
 * Field keys whose presence means money is being disclosed.
 *
 * Matched on the KEY rather than the value, because a currency-formatted value
 * is easy to spot and easy to disguise. `payment.amount` exists on the
 * BoardingPass model, and mapping it onto a pass is the mistake this catches.
 */
const MONEY_KEYS = /(balance|portfolio|amount|paid|total|value|usd|usdc|holdings|dividend)/i;

// WHAT THIS REDACTOR DOES NOT CATCH, stated so its coverage is not overread:
//
//   * Opaque tokens. A JWT or a PassKit `authenticationToken` pasted into a
//     field would pass every rule above — a JWT contains `0`, `I`, `O` and `l`,
//     so it is not base58, and it is not an address or a phone number. The
//     authenticationToken belongs at the top level of pass.json rather than in
//     a field, so it is out of reach here by construction, but a developer
//     debugging a pass could put one in a back field and this would not stop
//     them. No rule was added for it: every pattern broad enough to catch an
//     arbitrary token also catches ordinary booking references, and a redactor
//     that blocks legitimate content gets switched off.
//   * A 32-character hex id with no `0` in it matches the base58 rule. That
//     direction is safe — it refuses something that may have been fine — and
//     the thrown error names the rule so the false positive can be diagnosed
//     rather than guessed at.
//   * Semantics. It can tell that "Ada Lovelace" is not an address; it cannot
//     tell whether printing a passenger's full legal name is appropriate for a
//     given pass type. That stays a human decision.

export class PassDisclosureError extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly rule: string
  ) {
    super(message);
    this.name = "PassDisclosureError";
  }
}

/**
 * Refuse content that discloses more than a pass should.
 *
 * THROWS rather than sanitising. A silently stripped field produces a pass with
 * a blank row and no explanation, and the next person adds it back. Failing
 * names the rule and the field, so the decision gets made rather than reverted.
 *
 * Call this on every `PassContent` before it reaches a signer.
 */
export function assertNoOverDisclosure(content: PassContent): void {
  const groups: Array<[string, PassField[]]> = [
    ["headerFields", content.headerFields],
    ["primaryFields", content.primaryFields],
    ["secondaryFields", content.secondaryFields],
    ["auxiliaryFields", content.auxiliaryFields],
    // Back fields included deliberately. "It's on the back" is not a boundary:
    // flipping a pass needs no authentication.
    ["backFields", content.backFields],
  ];

  for (const [group, fields] of groups) {
    for (const f of fields) {
      if (MONEY_KEYS.test(f.key)) {
        throw new PassDisclosureError(
          `${group}.${f.key} discloses a monetary value. A pass is a lock-screen ` +
            `surface and a shareable file, and FurlPay ships Discreet Mode so users ` +
            `can hide balances — printing one here contradicts that.`,
          `${group}.${f.key}`,
          "no monetary values on a pass"
        );
      }
      for (const rule of FORBIDDEN) {
        if (rule.test.test(f.value)) {
          throw new PassDisclosureError(
            `${group}.${f.key} contains what looks like a ${rule.name}: ${rule.why}.`,
            `${group}.${f.key}`,
            rule.name
          );
        }
      }
    }
  }

  // The barcode is scanned by a third party's reader, so it is the one place a
  // routing identifier legitimately belongs — but it still must not carry a
  // credential, and it must not be a bare address either.
  for (const rule of FORBIDDEN) {
    if (rule.name === "EVM address" || rule.name === "Solana address") {
      if (rule.test.test(content.barcode.message)) {
        throw new PassDisclosureError(
          `The barcode encodes a raw ${rule.name}. Encode a resolvable FurlPay ` +
            `link instead, so the recipient is looked up server-side and the ` +
            `address can be rotated without reissuing the pass.`,
          "barcode.message",
          rule.name
        );
      }
    }
  }
}

// --- boarding pass ----------------------------------------------------------

/**
 * A boarding pass, as wallet content.
 *
 * WHAT IS DELIBERATELY OMITTED: `BoardingPass.payment`. The model carries
 * `{ currency, amount, rewardsRate }`, and a boarding pass does not need any of
 * it — an airline's own pass never prints the fare. Including it would put what
 * someone paid on their lock screen, which is exactly what the redactor above
 * refuses, so this is not merely an omission but the rule applied.
 *
 * Times are printed from the airport's own local wall clock, which is what the
 * traveller reads off the departure board, while `relevance.at` carries the
 * absolute instant so the OS surfaces the pass at the right moment wherever the
 * phone happens to be.
 */
export function boardingPassContent(pass: BoardingPass): PassContent {
  const f = pass.flight;
  return {
    kind: "boarding",
    serial: pass.id,
    organizationName: "FurlPay",
    description: `${f.originCode} → ${f.destinationCode} · ${f.number}`,
    headerFields: [{ key: "flight", label: "FLIGHT", value: f.number }],
    primaryFields: [
      { key: "origin", label: f.originCity, value: f.originCode },
      { key: "destination", label: f.destinationCity, value: f.destinationCode },
    ],
    secondaryFields: [
      { key: "passenger", label: "PASSENGER", value: pass.passenger.name },
      {
        key: "gate",
        label: "GATE",
        value: f.gate,
        // Worth an interruption: a gate change is the one update a traveller
        // must act on, and the only field here that changes late.
        changeMessage: "Gate changed to %@.",
      },
      { key: "seat", label: "SEAT", value: f.seat },
    ],
    auxiliaryFields: [
      { key: "boards", label: "BOARDS", value: f.boardingTime },
      { key: "departs", label: "DEPARTS", value: f.departureTime },
      { key: "arrives", label: "ARRIVES", value: f.arrivalTime },
    ],
    backFields: [
      { key: "aircraft", label: "Aircraft", value: f.aircraft },
      { key: "route", label: "Route", value: pass.routeLabel },
      { key: "reference", label: "Booking reference", value: pass.id },
    ],
    barcode: {
      // PDF417 is what airline scanners read.
      format: "pdf417",
      message: pass.id,
      altText: pass.id,
    },
    relevance: {
      // Boarding, not departure: the pass is wanted at the gate.
      at: pass.boardingAt,
      // EMPTY, and not a placeholder. A geofence needs the airport's real
      // coordinates, and lib/travel/airports.ts carries iata/name/city/country
      // with no latitude or longitude. Inventing them would surface the pass at
      // the wrong place, which is worse than not surfacing it — so this stays
      // empty until real coordinates exist.
      locations: [],
    },
  };
}

/**
 * Build and validate in one step.
 *
 * The only function callers should use: it is not possible to obtain content
 * from here that has not been through the redactor.
 */
export function safeBoardingPassContent(pass: BoardingPass): PassContent {
  const content = boardingPassContent(pass);
  assertNoOverDisclosure(content);
  return content;
}
