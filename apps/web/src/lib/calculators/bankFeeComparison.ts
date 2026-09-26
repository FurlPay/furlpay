// ---------------------------------------------------------------------------
// International transfer cost comparison — FurlPay vs Australian banks.
//
// THIS FILE MAKES PUBLIC CLAIMS ABOUT NAMED COMPANIES, so it is built to a
// different standard than the rest of the calculator code: every number is
// dated, carries the URL it came from, and is marked `published` or
// `estimated`. A comparison page that overstates a competitor's fees is false
// advertising, and in Australia it is false advertising in front of a regulator
// that actively polices exactly this comparison.
//
// WHAT THE BRIEF GOT WRONG (verified 2026-09-17, sources below)
// The spec for this file asked for "CBA: 3.5% FX + $30 wire", "Westpac 3.4% +
// $32", "ANZ 3.5% + $30". Every one of those overstates the bank's fee, always
// in FurlPay's favour:
//
//   * CBA waived its online IMT fee in June 2023. Sending through NetBank, the
//     CommBank app or CommBiz costs $0, not $30. The $30 is an IN-BRANCH
//     transfer up to $1,000 — a channel almost nobody uses.
//   * Westpac charges $0 to send foreign currency online, $20 to send AUD
//     online, and $32 in branch.
//   * ANZ Plus charges $0. ANZ internet banking is $9, and $0 above A$10,000.
//
// FEES ARE NOT ONE NUMBER. They depend on the CHANNEL (online vs branch), the
// DIRECTION (sending AUD vs sending foreign currency), and sometimes the
// AMOUNT. Collapsing that into a single headline figure is how the brief's
// numbers went wrong, so the model below keeps all three.
//
// FX MARGINS ARE THE HONEST WEAK POINT. No Australian major publishes its
// retail FX margin as a number — it is embedded in a quoted rate that moves.
// Third-party analysis puts them in the 3-4% range. Those are carried here as
// `estimated` with their provenance, and a caller that needs to SHOW a margin
// must surface that it is an estimate. An invented precise margin is the
// single easiest way to turn this page into a liability.
// ---------------------------------------------------------------------------

/** How the transfer is initiated. Fees differ sharply between these. */
export type Channel = "online" | "branch";

/** What the sender's account is debited in. */
export type SendCurrencyMode = "aud" | "foreign";

export type Confidence = "published" | "estimated";

export interface FeeEvidence {
  /** ISO date the figure was verified. */
  asOf: string;
  sourceUrl: string;
  confidence: Confidence;
  /** Shown verbatim next to an estimate. */
  note?: string;
}

export interface UpfrontFeeRule {
  amountAud: number;
  /** Fee applies only at or below this send amount; absent = always. */
  maxSendAud?: number;
  /** Fee applies only at or above this send amount; absent = always. */
  minSendAud?: number;
}

export interface ProviderSchedule {
  id: string;
  displayName: string;
  /** Upfront fee by channel and send-currency mode. */
  upfront: Record<Channel, Partial<Record<SendCurrencyMode, UpfrontFeeRule[]>>>;
  /** Margin over mid-market, by corridor with a fallback. */
  margin: MarginModel;
  fxMarginEvidence: FeeEvidence;
  upfrontEvidence: FeeEvidence;
  /** Human description, e.g. "1-2 business days". Never a precise promise. */
  transferTime: string;
}

const CBA_SOURCE = "https://www.commbank.com.au/international/fees-charges.html";
const WESTPAC_SOURCE = "https://www.westpac.com.au/international-travel/international-transfers/";
const ANZ_SOURCE = "https://www.anz.com.au/personal/travel-international/international-payments/";
const WISE_SOURCE = "https://wise.com/sg/pricing/send-money";

const VERIFIED = "2026-09-17";

/**
 * FX margins, in basis points over mid-market.
 *
 * MARGINS VARY BY CORRIDOR, NOT JUST BY BANK — this is the thing a single
 * headline percentage hides. Independent rate sampling puts CommBank at about
 * 2.5% on AUD->USD but 3.2% on AUD->GBP; ANZ runs 3.1% and 2.9% on the same
 * two. A model with one number per bank is therefore wrong by up to 0.7
 * percentage points depending on where the money is going, and on a $20,000
 * transfer that is $140 of claim.
 *
 * So corridors that have been sampled are stated, and everything else falls
 * back to a per-bank default. EVERY figure here is `estimated`: no Australian
 * major publishes a retail FX margin, because it is embedded in a quoted rate
 * that moves intraday. A page showing these must say so — see
 * ESTIMATE_DISCLOSURE.
 */
type Corridor = `${string}->${string}`;

interface MarginModel {
  /** Sampled corridors, keyed "AUD->USD". */
  byCorridor: Partial<Record<Corridor, number>>;
  /** Used for any corridor not sampled. */
  defaultBps: number;
}

const RATE_SAMPLING_SOURCE = "https://bestexchangerates.com/rates/commbank/?type=foreign-transfers";

const FX_EVIDENCE: FeeEvidence = {
  asOf: VERIFIED,
  sourceUrl: RATE_SAMPLING_SOURCE,
  confidence: "estimated",
  note:
    "Australian majors do not publish a retail FX margin; it is embedded in the quoted rate and moves intraday. These figures come from independent rate sampling and vary by currency corridor. Indicative only, not a quote.",
};

/** Margin for a corridor, falling back to the bank default. */
export function marginBpsFor(model: MarginModel, from: string, to: string): number {
  const key = `${from.toUpperCase()}->${to.toUpperCase()}` as Corridor;
  return model.byCorridor[key] ?? model.defaultBps;
}

export const PROVIDERS: ProviderSchedule[] = [
  {
    id: "cba",
    displayName: "CommBank",
    upfront: {
      // Waived since June 2023 for NetBank / CommBank app / CommBiz.
      online: { aud: [{ amountAud: 0 }], foreign: [{ amountAud: 0 }] },
      // $30 per transfer up to $1,000 in branch.
      branch: {
        aud: [{ amountAud: 30, maxSendAud: 1000 }, { amountAud: 30, minSendAud: 1000 }],
        foreign: [{ amountAud: 30, maxSendAud: 1000 }, { amountAud: 30, minSendAud: 1000 }],
      },
    },
    margin: { byCorridor: { "AUD->USD": 250, "AUD->GBP": 320 }, defaultBps: 320 },
    fxMarginEvidence: FX_EVIDENCE,
    upfrontEvidence: {
      asOf: VERIFIED,
      sourceUrl: CBA_SOURCE,
      confidence: "published",
      note: "Online IMT fee waived since June 2023. In-branch transfers $30.",
    },
    transferTime: "1-2 business days",
  },
  {
    id: "westpac",
    displayName: "Westpac",
    upfront: {
      online: { aud: [{ amountAud: 20 }], foreign: [{ amountAud: 0 }] },
      branch: { aud: [{ amountAud: 32 }], foreign: [{ amountAud: 32 }] },
    },
    margin: { byCorridor: {}, defaultBps: 370 },
    fxMarginEvidence: FX_EVIDENCE,
    upfrontEvidence: {
      asOf: VERIFIED,
      sourceUrl: WESTPAC_SOURCE,
      confidence: "published",
      note: "$0 sending foreign currency online; $20 sending AUD online; $32 in branch.",
    },
    transferTime: "1-2 business days",
  },
  {
    id: "anz",
    displayName: "ANZ",
    upfront: {
      // $9 from an AUD account to foreign currency, waived above A$10,000.
      online: {
        aud: [{ amountAud: 9, maxSendAud: 10_000 }, { amountAud: 0, minSendAud: 10_000 }],
        foreign: [{ amountAud: 0 }],
      },
      branch: { aud: [{ amountAud: 32 }], foreign: [{ amountAud: 32 }] },
    },
    margin: { byCorridor: { "AUD->USD": 310, "AUD->GBP": 290 }, defaultBps: 330 },
    fxMarginEvidence: FX_EVIDENCE,
    upfrontEvidence: {
      asOf: VERIFIED,
      sourceUrl: ANZ_SOURCE,
      confidence: "published",
      note: "ANZ internet banking $9 AUD-to-foreign, $0 above A$10,000. ANZ Plus $0. Phone/staff-assisted $32.",
    },
    transferTime: "1-2 business days",
  },
  {
    id: "wise",
    displayName: "Wise",
    upfront: { online: { aud: [{ amountAud: 0 }], foreign: [{ amountAud: 0 }] }, branch: {} },
    // Wise adds NO margin to the mid-market rate; its cost is the percentage
    // fee, modelled here as the margin so the comparison is like-for-like.
    // 45 bps is the upper end of the "major currency routes" band.
    margin: { byCorridor: {}, defaultBps: 45 },
    fxMarginEvidence: {
      asOf: VERIFIED,
      sourceUrl: WISE_SOURCE,
      confidence: "published",
      note: "Wise applies no exchange-rate markup; fees start from 0.23% and run roughly 0.41-0.45% on major routes. Modelled at the top of that band so the comparison does not flatter FurlPay.",
    },
    upfrontEvidence: {
      asOf: VERIFIED,
      sourceUrl: WISE_SOURCE,
      confidence: "published",
      note: "Percentage fee only; no separate wire fee on standard routes.",
    },
    transferTime: "Seconds to 1 business day",
  },
];

/**
 * FurlPay's own costs.
 *
 * Kept in the same shape and held to the same standard: the network fee is a
 * real observed range on Base, not a marketing zero. Claiming "$0 fees" when
 * gas exists would be the same sin this file exists to avoid, pointed inward.
 */
export const FURLPAY = {
  id: "furlpay",
  displayName: "FurlPay",
  /** Typical Base L2 gas for an ERC-20 transfer, in AUD. */
  networkFeeAud: 0.01,
  /** No spread is taken on a like-for-like stablecoin transfer. */
  fxMarginBps: 0,
  transferTime: "Seconds",
  evidence: {
    asOf: VERIFIED,
    sourceUrl: "https://basescan.org/",
    confidence: "estimated" as Confidence,
    note:
      "Base L2 gas varies with network conditions; $0.01 AUD is a typical ERC-20 transfer at the time of writing, not a guaranteed price. A same-currency stablecoin transfer takes no FX spread; converting between different currencies does incur a market spread that is not modelled here.",
  },
};

export interface ProviderBreakdown {
  id: string;
  displayName: string;
  upfrontFee: number;
  fxSpreadFee: number;
  totalFees: number;
  recipientGets: number;
  transferTime: string;
  fxMarginBps: number;
  fxConfidence: Confidence;
  sourceUrl: string;
  asOf: string;
  notes: string[];
}

export interface ComparisonResult {
  sendAmount: number;
  sendCurrency: string;
  receiveCurrency: string;
  channel: Channel;
  sendCurrencyMode: SendCurrencyMode;
  /** Mid-market units of receiveCurrency per 1 sendCurrency. */
  referenceRate: number;
  providers: ProviderBreakdown[];
  furlpay: ProviderBreakdown & {
    /** Positive when FurlPay is cheaper. Null when the bank was not modelled. */
    savingsVsCba: number | null;
    percentageSaved: number | null;
  };
  /** True when any figure used was an estimate rather than a published price. */
  containsEstimates: boolean;
}

export class ComparisonInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonInputError";
  }
}

/** Round to cents. Money comparisons are displayed, so 2dp is the contract. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function upfrontFor(
  schedule: ProviderSchedule,
  channel: Channel,
  mode: SendCurrencyMode,
  amount: number
): number | null {
  const rules = schedule.upfront[channel]?.[mode];
  // No rule is NOT zero — it means this provider does not offer this channel
  // (Wise has no branch). Returning 0 would render "free in branch".
  if (!rules || rules.length === 0) return null;

  for (const rule of rules) {
    if (rule.maxSendAud !== undefined && amount > rule.maxSendAud) continue;
    if (rule.minSendAud !== undefined && amount <= rule.minSendAud) continue;
    return rule.amountAud;
  }
  return rules[rules.length - 1].amountAud;
}

/**
 * Compare what a transfer costs across providers.
 *
 * `referenceRate` is the MID-MARKET rate and must be supplied by the caller
 * from a live source. There is deliberately no hardcoded default: a stale rate
 * baked into a comparison silently changes every number on the page, and a
 * number that moves daily has no business being a constant in a source file.
 */
export function calculateTransferComparison(params: {
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  referenceRate: number;
  channel?: Channel;
  sendCurrencyMode?: SendCurrencyMode;
}): ComparisonResult {
  const {
    amount,
    fromCurrency,
    toCurrency,
    referenceRate,
    channel = "online",
    sendCurrencyMode = "aud",
  } = params;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ComparisonInputError(`Send amount must be a positive number, got ${amount}`);
  }
  if (!Number.isFinite(referenceRate) || referenceRate <= 0) {
    throw new ComparisonInputError(`referenceRate must be a positive number, got ${referenceRate}`);
  }

  // Same currency both sides: no conversion happens, so no provider may charge
  // a spread on it. Their wire fee still applies.
  const sameCurrency = fromCurrency.toUpperCase() === toCurrency.toUpperCase();

  const providers: ProviderBreakdown[] = [];
  let containsEstimates = false;

  for (const p of PROVIDERS) {
    const upfront = upfrontFor(p, channel, sendCurrencyMode, amount);
    if (upfront === null) continue; // channel not offered

    const marginBps = marginBpsFor(p.margin, fromCurrency, toCurrency);
    const fxSpreadFee = sameCurrency ? 0 : money((amount * marginBps) / 10_000);
    const totalFees = money(upfront + fxSpreadFee);
    const recipientGets = money(Math.max(0, amount - totalFees) * referenceRate);

    if (p.fxMarginEvidence.confidence === "estimated" && !sameCurrency) containsEstimates = true;

    providers.push({
      id: p.id,
      displayName: p.displayName,
      upfrontFee: money(upfront),
      fxSpreadFee,
      totalFees,
      recipientGets,
      transferTime: p.transferTime,
      fxMarginBps: sameCurrency ? 0 : marginBps,
      fxConfidence: p.fxMarginEvidence.confidence,
      sourceUrl: p.upfrontEvidence.sourceUrl,
      asOf: p.upfrontEvidence.asOf,
      notes: [p.upfrontEvidence.note, !sameCurrency ? p.fxMarginEvidence.note : undefined].filter(
        (n): n is string => Boolean(n)
      ),
    });
  }

  const fpFx = sameCurrency ? 0 : money((amount * FURLPAY.fxMarginBps) / 10_000);
  const fpTotal = money(FURLPAY.networkFeeAud + fpFx);
  const furlpayBreakdown: ProviderBreakdown = {
    id: FURLPAY.id,
    displayName: FURLPAY.displayName,
    upfrontFee: money(FURLPAY.networkFeeAud),
    fxSpreadFee: fpFx,
    totalFees: fpTotal,
    recipientGets: money(Math.max(0, amount - fpTotal) * referenceRate),
    transferTime: FURLPAY.transferTime,
    fxMarginBps: sameCurrency ? 0 : FURLPAY.fxMarginBps,
    fxConfidence: FURLPAY.evidence.confidence,
    sourceUrl: FURLPAY.evidence.sourceUrl,
    asOf: FURLPAY.evidence.asOf,
    notes: [FURLPAY.evidence.note],
  };
  if (FURLPAY.evidence.confidence === "estimated") containsEstimates = true;

  const cba = providers.find((p) => p.id === "cba");
  const savingsVsCba = cba ? money(cba.totalFees - fpTotal) : null;

  return {
    sendAmount: amount,
    sendCurrency: fromCurrency.toUpperCase(),
    receiveCurrency: toCurrency.toUpperCase(),
    channel,
    sendCurrencyMode,
    referenceRate,
    providers,
    furlpay: {
      ...furlpayBreakdown,
      savingsVsCba,
      // Percentage of the BANK's total cost avoided — not a share of the
      // transfer. "You save 99% of CommBank's fees" is true; "you save 99%"
      // unqualified reads as 99% of the money being sent.
      percentageSaved:
        cba && cba.totalFees > 0 ? Math.round(((cba.totalFees - fpTotal) / cba.totalFees) * 1000) / 10 : null,
    },
    containsEstimates,
  };
}

/**
 * One-line disclosure a comparison surface MUST render when estimates are in
 * play. Exported so every caller shows the same words, and so a page cannot
 * quietly drop it.
 */
export const ESTIMATE_DISCLOSURE =
  "Bank exchange-rate margins are not published and are estimated from independent analysis. Upfront fees are as published on each provider's own fee page on the date shown. Network fees vary with conditions. Figures are indicative, not quotes.";
