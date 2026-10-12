// ---------------------------------------------------------------------------
// The three FurlPay card designs, and the rules for what a card back may show.
//
// THE DESIGNS ARE THE ONES ON furlpay.com/telegram (apps/web
// components/telegram/PaymentCard.tsx + app/telegram/telegram.css). The colour
// stops below are lifted from that stylesheet rather than re-picked, so the app
// and the web draw the same card. The server names them as themes
// (CARD_THEMES: electric / world / pearl); a theme the app does not know keeps
// its plain two-colour gradient.
//
// NO CARD DIGITS ARE EVER CONSTRUCTED HERE. The back of the card has a place
// for the number, the expiry and the CVV, and `parseCardSecrets` is the only
// way to fill it: it accepts a vault response and rejects anything that is not
// a real card (wrong length, failed Luhn check, a last four that belongs to a
// different card, an expiry in the past). There is no issuer vault to call
// yet, so every caller passes `null` today and the back renders masked.
// ---------------------------------------------------------------------------

export type CardDesign = "electric" | "world" | "pearl";

export interface CardDesignSpec {
  id: CardDesign;
  name: string;
  /** Background gradient, top-left to bottom-right. */
  colors: readonly [string, string, ...string[]];
  locations?: readonly [number, number, ...number[]];
  /** Thin diagonal light streaks drawn over the background. */
  streaks: { colors: readonly [string, string, ...string[]]; locations: readonly [number, number, ...number[]] } | null;
  /** True for the design that carries the globe artwork. */
  art: boolean;
  border: string;
  ink: string;
  inkDim: string;
  /** Text shown on the card must stay readable: pearl is the one light card. */
  light: boolean;
}

export const CARD_DESIGNS: Record<CardDesign, CardDesignSpec> = {
  electric: {
    id: "electric",
    name: "Electric",
    colors: ["#14197D", "#1C24C5", "#006BFF", "#004CEA"],
    locations: [0, 0.46, 0.75, 1],
    streaks: {
      colors: ["transparent", "transparent", "#9257FF", "transparent", "transparent", "#3CDCFF", "#8BF2FF", "transparent", "transparent"],
      locations: [0, 0.51, 0.511, 0.514, 0.68, 0.682, 0.684, 0.69, 1],
    },
    art: false,
    border: "#5155EB",
    ink: "#FFFFFF",
    inkDim: "rgba(255,255,255,0.72)",
    light: false,
  },
  world: {
    id: "world",
    name: "World",
    colors: ["#060B21", "#081432"],
    streaks: null,
    art: true,
    border: "#4583D1",
    ink: "#FFFFFF",
    inkDim: "rgba(231,237,255,0.78)",
    light: false,
  },
  pearl: {
    id: "pearl",
    name: "Pearl",
    colors: ["#F1F0FF", "#B8CBFF", "#C7A7F8"],
    locations: [0, 0.5, 1],
    streaks: {
      colors: ["transparent", "transparent", "rgba(255,255,255,0.58)", "transparent", "transparent", "rgba(255,255,255,0.53)", "transparent", "transparent"],
      locations: [0, 0.58, 0.581, 0.584, 0.66, 0.661, 0.664, 1],
    },
    art: false,
    border: "#E7E4FF",
    ink: "#353E6E",
    inkDim: "rgba(53,62,110,0.72)",
    light: true,
  },
};

export const CARD_DESIGN_ORDER: readonly CardDesign[] = ["electric", "world", "pearl"];

// The gradient the server publishes for each design (CARD_THEMES). The cards
// list returns only a gradient, not a theme id, so this is how a card on that
// screen is recognised as one of the three.
const GRADIENT_KEY: Record<string, CardDesign> = {
  "#14197d|#006bff": "electric",
  "#060b21|#0b2a6b": "world",
  "#f1f0ff|#c7a7f8": "pearl",
};

/** Which of the three designs a card wears, or null for a plain gradient. */
export function designFor(input: {
  themeId?: string | null;
  gradient?: readonly string[] | null;
}): CardDesign | null {
  const id = input.themeId?.toLowerCase();
  if (id === "electric" || id === "world" || id === "pearl") return id;
  const g = input.gradient;
  if (g && g.length === 2 && typeof g[0] === "string" && typeof g[1] === "string") {
    return GRADIENT_KEY[`${g[0].toLowerCase()}|${g[1].toLowerCase()}`] ?? null;
  }
  return null;
}

/** The spec to paint with: one of the three designs, or a plain two-colour
 *  card (an older theme) drawn with white ink. */
export function specFor(design: CardDesign | null, gradient: readonly [string, string]): CardDesignSpec | PlainCardSpec {
  if (design) return CARD_DESIGNS[design];
  return {
    id: null,
    name: "Classic",
    colors: [gradient[0], gradient[1]],
    streaks: null,
    art: false,
    border: "rgba(255,255,255,0.14)",
    ink: "#FFFFFF",
    inkDim: "rgba(255,255,255,0.72)",
    light: false,
  };
}

export type PlainCardSpec = Omit<CardDesignSpec, "id"> & { id: null };

// ---- card back --------------------------------------------------------------

/** Full card details, exactly as the issuer's vault returned them. */
export interface CardSecrets {
  pan: string;
  expMonth: number;
  expYear: number;
  cvv: string;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Accept a vault response, or reject it. Returns null for anything that is not
 * a complete, plausible card belonging to `last4`, so a truncated or mismatched
 * response is never rendered as though it were the customer's card.
 */
export function parseCardSecrets(raw: unknown, last4: string, now: Date = new Date()): CardSecrets | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.pan !== "string" || typeof r.cvv !== "string") return null;
  const pan = r.pan.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(pan) || !luhnValid(pan)) return null;
  if (!/^\d{4}$/.test(last4) || !pan.endsWith(last4)) return null;
  if (!/^\d{3,4}$/.test(r.cvv)) return null;
  const expMonth = Number(r.expMonth);
  let expYear = Number(r.expYear);
  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) return null;
  if (!Number.isInteger(expYear)) return null;
  if (expYear >= 0 && expYear < 100) expYear += 2000;
  if (expYear < 2000 || expYear > 2100) return null;
  // A card is valid through the last day of its expiry month.
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  if (expYear < y || (expYear === y && expMonth < m)) return null;
  return { pan, expMonth, expYear, cvv: r.cvv };
}

/** "4111111111111111" → "4111 1111 1111 1111" (Amex-length numbers 4-6-5). */
export function groupPan(pan: string): string {
  if (pan.length === 15) return `${pan.slice(0, 4)} ${pan.slice(4, 10)} ${pan.slice(10)}`;
  return pan.replace(/(.{4})(?=.)/g, "$1 ");
}

export interface CardBackFields {
  number: string;
  expiry: string;
  cvv: string;
  /** False when the fields are masks, not card details. */
  revealed: boolean;
}

/** What the back of the card prints. Masks unless real secrets were supplied. */
export function cardBackFields(last4: string, secrets: CardSecrets | null): CardBackFields {
  if (!secrets) {
    const tail = /^\d{4}$/.test(last4) ? last4 : "••••";
    return { number: `•••• •••• •••• ${tail}`, expiry: "••/••", cvv: "•••", revealed: false };
  }
  const mm = String(secrets.expMonth).padStart(2, "0");
  const yy = String(secrets.expYear % 100).padStart(2, "0");
  return { number: groupPan(secrets.pan), expiry: `${mm}/${yy}`, cvv: secrets.cvv, revealed: true };
}

/** How long revealed details may stay on screen before the card turns back. */
export const REVEAL_VISIBLE_MS = 30_000;
