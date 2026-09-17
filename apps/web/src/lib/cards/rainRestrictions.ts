// ---------------------------------------------------------------------------
// The issuer's own restrictions, which are NOT ours and which we do not control.
//
// Rain declines some merchant categories and some named merchants by default,
// before any policy of ours is consulted. Encoding that here lets FurlPay find
// out at ISSUANCE — or at booking — instead of at a checkout, where the failure
// is a customer standing at a terminal with a card that does not work and no
// explanation available to support.
//
// THE LIST BELOW IS TRANSCRIBED FROM RAIN'S DOCUMENTATION, not inferred. Two
// caveats that matter more than the list itself:
//
//   1. Rain ALSO runs a dynamic blocklist, driven by proactive monitoring,
//      dispute/fraud rates, and tenant request. It changes continuously and is
//      not published. So a merchant absent from here can still decline, and
//      `rainWillDecline` returning false means "not blocked by a rule we can
//      see" — never "this will be approved".
//   2. These are the issuer's defaults for a program. Yours may differ once
//      configured. Re-read the docs before treating this as authoritative for
//      a live program.
//
// WHY THIS FILE EXISTS AT ALL — two collisions with FurlPay's own products that
// are worth finding now rather than in production:
//
//   TRAVEL. The travel VCN locks cards to 7011 (lodging), 4511 (airlines) and
//   7512 (car rental), none of which are blocked. But 5962, "Direct Marketing —
//   Travel Related Arrangement Services", IS blocked by default, and that is
//   the category an online travel agency commonly presents as. A card locked to
//   7011 that meets a booking platform billing as 5962 fails twice over: our
//   own MCC lock rejects it, and the issuer would have declined it anyway.
//
//   INVESTING and CRYPTO. 6211 (Securities Brokers and Dealers), 6051 (Quasi
//   Cash), 6540 (Point-of-Interaction Funding) and the 6010/6011/6012 financial
//   institution codes are all blocked. Card-funded brokerage or crypto purchase
//   is therefore not available on this rail regardless of what our own policy
//   engine permits.
// ---------------------------------------------------------------------------

/** Merchant categories the issuer declines by default, with their meaning. */
export const RAIN_BLOCKED_MCCS: Readonly<Record<string, string>> = {
  "2892": "Explosives",
  "3484": "Small Arms and Weapons",
  "4829": "Wire Transfers and Money Orders",
  "5122": "Drug Stores and Proprietary Drugs",
  "5681": "Furriers and Fur Shops",
  "5932": "Antique Shops",
  "5933": "Pawn Shops",
  "5937": "Antique Reproductions",
  "5960": "Direct Marketing – Insurance",
  "5962": "Direct Marketing – Travel Related Arrangement Services",
  "5965": "Direct Marketing – Catalog and Retail",
  "5966": "Direct Marketing – Outbound Telemarketing",
  "5967": "Direct Marketing – Inbound Telemarketing",
  "5969": "Direct Marketing – Other",
  "5972": "Stamp and Coin Stores",
  "5993": "Cigar Stores and Stands",
  "6010": "Financial Institutions – Manual Cash Disbursements",
  "6011": "Financial Institutions – Automated Cash Disbursements",
  "6012": "Financial Institutions – Merchandise and Services",
  "6050": "Quasi Cash – Member Financial Institutions",
  "6051": "Quasi Cash",
  "6211": "Securities Brokers and Dealers",
  "6529": "Remote Stored Value Load – Member Financial Institution",
  "6530": "Remote Stored Value Load – Merchant",
  "6531": "Payment Service Provider – Money Transfer",
  "6532": "Payment Transactions – Member Financial Institution",
  "6533": "Payment Transactions – Merchant",
  "6534": "Money Transfer – Member Financial Institution",
  "6535": "Value Purchase – Member Financial Institution",
  "6536": "MoneySend – Intracountry",
  "6537": "MoneySend – Intercountry",
  "6538": "MoneySend Funding Transaction",
  "6540": "Point-of-Interaction Funding Transactions",
  "6555": "Mastercard Initiated Rebate/Rewards",
  "6611": "Overpayments",
  "6760": "Savings Bonds",
  "7272": "Escort Services",
  "7273": "Dating or Escort Services",
  "7280": "Hospital Patient Personal Funds Withdrawals",
  "7297": "Massage Parlors",
  "7322": "Debt Collection Agencies",
  "7800": "Government-Owned Lotteries",
  "7801": "Government-Licensed Online Casinos",
  "7802": "Government-Licensed Horse/Dog Racing",
  "7948": "Race Organizations",
  "7995": "Gambling, Betting, Lotteries",
  "8631": "Labor Unions",
  "8651": "Political Organizations",
  "8661": "Religious Organizations",
  "9223": "Bail and Bond Payments",
  "9401": "I-Purchasing Pilot",
  "9405": "Intra-Government Purchases",
  "9411": "Government Loan Payments",
  "9700": "International Automated Referral Service (Visa only)",
  "9701": "Visa Credential Server (Visa only)",
  "9702": "GCAS Emergency Services (Visa only)",
  "9721": "International Affairs (Embassies)",
  "9754": "Gambling – Horse Racing, Dog Racing, State Lotteries",
  "9950": "Intra-Company Purchases",
};

/**
 * Named merchants the issuer blocks by default that FurlPay's own product
 * surfaces or documentation references. Deliberately a SUBSET of the published
 * list — the full list is long, changes, and most of it never intersects
 * anything we do. These are the ones that would surprise someone here.
 *
 * `Wise` is the one to notice: FurlPay's off-ramp is described in its own
 * source as going over "Wise rails", and a FurlPay card cannot pay Wise.
 * Those are different directions of money movement, so it is not a
 * contradiction — but it is exactly the kind of thing that reads as a bug at
 * 2am if nobody wrote it down.
 */
export const RAIN_BLOCKED_MERCHANTS_OF_NOTE: readonly string[] = [
  "Wise",
  "MoonPay",
  "Skrill",
  "Neteller",
  "eToro",
  "CEX.IO",
  "Deriv",
  "Blockchain.com Europe",
  "Simplex", // partial
  "RampSwaps",
  "WePay",
  "OpenPay",
  "PayFast",
  "Yandex",
  "Vodafone",
];

/** MCCs FurlPay's travel product locks cards to. None is blocked — checked. */
export const FURLPAY_TRAVEL_MCCS = ["7011", "4511", "7512"] as const;

export interface RestrictionVerdict {
  /** True when a published issuer rule blocks this outright. */
  blocked: boolean;
  /** Why, in words a support agent can repeat to a customer. */
  reason?: string;
}

/**
 * Whether the issuer's published rules decline this merchant category.
 *
 * NOT a prediction of approval. Rain's dynamic blocklist is unpublished and
 * updates continuously, so `blocked: false` means "no rule we can see", and an
 * authorisation can still decline for reasons only the issuer knows.
 */
export function rainWillDecline(mcc: string): RestrictionVerdict {
  const category = RAIN_BLOCKED_MCCS[mcc.trim()];
  if (!category) return { blocked: false };
  return {
    blocked: true,
    reason: `The card issuer declines merchant category ${mcc} (${category}) by default.`,
  };
}

/**
 * Check an MCC allowlist before a card is issued against it.
 *
 * Issuing a card restricted to a category the ISSUER blocks produces a card
 * that cannot transact anywhere — which looks, to everyone involved, like the
 * card is broken. Catching it here turns that into an error at the moment
 * somebody asked for it.
 */
export function unusableMccs(allowedMccs: readonly string[]): string[] {
  return allowedMccs.filter((mcc) => rainWillDecline(mcc).blocked);
}

/**
 * Visa's per-product maximum authorisation at the point of sale, in MINOR
 * units, from Visa's BASE II clearing specification.
 *
 * These are NETWORK ceilings, not our limits and not the issuer's: a
 * transaction above the ceiling cannot be authorised at all, whatever any
 * policy says. Useful only as an upper bound sanity check — a spend limit
 * configured above these is unreachable and therefore a configuration error.
 */
export const VISA_POS_MAX_MINOR: Readonly<Record<string, number>> = {
  "Visa Signature": 74_999_999,
  "Visa Platinum": 24_999_999,
  "Visa Infinite": 99_999_999,
  "Visa Corporate T&E": 74_999_999,
};

/** Prepaid POS ceiling is far lower than credit/debit on every product. */
export const VISA_PREPAID_POS_MAX_MINOR = 9_999_999;
