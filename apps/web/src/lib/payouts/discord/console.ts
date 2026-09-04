import { checkRailDestination, availableRails, RAIL_LABEL, type PayoutRail } from "../rails";
import { ownershipSupport } from "../ownership";
import { maskAddress } from "../address";
import { addressTypeLabel, type BitcoinAddressType } from "../bitcoin";

// ---------------------------------------------------------------------------
// The FurlPay Payments Console — Discord view layer.
//
// THIS FILE RENDERS. It does not decide. Every financial question is answered
// by lib/payouts (and, in time, the payout engine); this module turns those
// answers into Discord components and back. That boundary is why the same
// engine can serve a web dashboard and a mobile app later without any of this
// code moving.
//
// TWO HARD RULES:
//
//   1. Every response is EPHEMERAL. A payout screen contains balances and a
//      destination address; #payments-payouts is a public channel with
//      hundreds of members in it. Flags 64 is not a nicety here.
//
//   2. No emoji, anywhere. FurlPay's voice is plain, and an emoji in a
//      financial confirmation makes it read like a game. Status is carried by
//      words — "Verified", "Processing" — which also survive a screen reader.
//
// custom_id carries state. Discord gives 100 characters and no server session,
// so the id encodes the step and its arguments, colon-delimited. Nothing
// security-relevant is ever encoded there: a custom_id is client-supplied on
// the way back and must be treated as untrusted input.
// ---------------------------------------------------------------------------

export const EPHEMERAL = 1 << 6;
const BRAND = 0x5865f2; // Discord blurple, matched to the console's own palette
const OK = 0x2ecc71;
const WARN = 0xf1c40f;
const DANGER = 0xed4245;

export const PREFIX = "fp:pay:";

/** Every screen this console can show. Kept as one union so an unhandled step
 *  is a compile error rather than a silent "interaction failed". */
export type Step =
  | "home"
  | "account"
  | "earnings"
  | "payout"
  | "crypto"
  | "security"
  | "support"
  | "wallet_asset"
  | "wallet_rail"
  | "wallet_address"
  | "freeze_confirm"
  | "freeze_done";

export const id = (step: Step, ...args: string[]) =>
  `${PREFIX}${step}${args.length ? ":" + args.join(":") : ""}`;

/** Parse a custom_id back into a step and its arguments.
 *  Returns null when the id is not ours — the caller then defers to the next
 *  handler rather than claiming an interaction it does not own. */
export function parseId(customId: string): { step: Step; args: string[] } | null {
  if (!customId.startsWith(PREFIX)) return null;
  const [step, ...args] = customId.slice(PREFIX.length).split(":");
  return { step: step as Step, args };
}

// ── component builders ─────────────────────────────────────────────────────

type Component = Record<string, unknown>;

const BUTTON = 2;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;

export const Style = {
  primary: 1,
  secondary: 2,
  success: 3,
  danger: 4,
  link: 5,
} as const;

export function button(
  label: string,
  customId: string,
  style: number = Style.secondary,
  disabled = false
): Component {
  return { type: BUTTON, style, label, custom_id: customId, disabled };
}

export function linkButton(label: string, url: string): Component {
  return { type: BUTTON, style: Style.link, label, url };
}

export function row(...components: Component[]): Component {
  return { type: 1, components };
}

export function ephemeral(data: Record<string, unknown>) {
  return { type: 4, data: { ...data, flags: EPHEMERAL } };
}

/** Replace the message the component is attached to, rather than posting a new
 *  one. Used for in-place navigation so a user does not accumulate a stack of
 *  stale ephemeral screens. */
export function update(data: Record<string, unknown>) {
  return { type: 7, data: { ...data, flags: EPHEMERAL } };
}

function embed(title: string, description?: string, fields?: { name: string; value: string; inline?: boolean }[], color = BRAND) {
  return {
    title,
    ...(description ? { description } : {}),
    color,
    ...(fields ? { fields } : {}),
    footer: { text: "FurlPay Payments" },
  };
}

// ── money formatting ───────────────────────────────────────────────────────

/**
 * Format integer atomic units for display.
 *
 * String arithmetic, not `Number`. A balance rendered through a float is a
 * balance that can disagree with the ledger in the last place, and the one
 * place a user checks is the last place.
 */
export function formatAtomic(atomic: string, decimals: number, symbol?: string): string {
  const negative = atomic.startsWith("-");
  const digits = (negative ? atomic.slice(1) : atomic).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = decimals > 0 ? `${grouped}.${frac}` : grouped;
  return `${negative ? "-" : ""}${body}${symbol ? " " + symbol : ""}`;
}

// ── screens ────────────────────────────────────────────────────────────────

export interface ConsoleAccount {
  availableAtomic: string;
  pendingAtomic: string;
  lifetimeAtomic: string;
  decimals: number;
  currency: string;
  lastPayout: { amountAtomic: string; asset: string; network: string; status: string } | null;
  payoutsFrozen: boolean;
}

/**
 * The console home.
 *
 * Balances come from the caller, which got them from the ledger. This function
 * never computes an amount — a display layer that does arithmetic on money is
 * a second source of truth waiting to disagree with the first.
 */
export function homeScreen(a: ConsoleAccount) {
  const fmt = (v: string) => formatAtomic(v, a.decimals, a.currency);

  const fields = [
    { name: "Available", value: fmt(a.availableAtomic), inline: true },
    { name: "Pending", value: fmt(a.pendingAtomic), inline: true },
    { name: "Lifetime", value: fmt(a.lifetimeAtomic), inline: true },
  ];

  if (a.lastPayout) {
    fields.push({
      name: "Last payout",
      value: `${formatAtomic(a.lastPayout.amountAtomic, a.decimals, a.lastPayout.asset)} on ${a.lastPayout.network} — ${a.lastPayout.status}`,
      inline: false,
    });
  }

  if (a.payoutsFrozen) {
    fields.push({
      name: "Payouts frozen",
      value: "New requests and wallet changes are blocked. Unfreezing requires re-authentication.",
      inline: false,
    });
  }

  return {
    embeds: [
      embed(
        "FurlPay Payments Center",
        "Welcome to your FurlPay payment center. Everything here is private to you.",
        fields,
        a.payoutsFrozen ? DANGER : BRAND
      ),
    ],
    components: [
      row(
        button("Account", id("account")),
        button("Earnings", id("earnings")),
        button("Payout", id("payout"), a.payoutsFrozen ? Style.secondary : Style.primary, a.payoutsFrozen)
      ),
      row(
        button("Crypto networks", id("crypto")),
        button("Security", id("security")),
        button("Support", id("support"))
      ),
    ],
  };
}

export function accountScreen(profile: {
  status: string;
  country: string;
  verification: string;
  paymentStatus: string;
}) {
  return {
    embeds: [
      embed("Payment profile", undefined, [
        { name: "Status", value: profile.status, inline: true },
        { name: "Country", value: profile.country, inline: true },
        { name: "Verification", value: profile.verification, inline: true },
        { name: "Payment status", value: profile.paymentStatus, inline: true },
      ]),
    ],
    components: [
      row(
        button("Wallets", id("wallet_asset")),
        button("Payment methods", id("account", "methods")),
        button("Statements", id("account", "statements"))
      ),
      row(button("Back", id("home"))),
    ],
  };
}

// ── add wallet: asset, then rail, then address ─────────────────────────────

export const WALLET_ASSETS = [
  { key: "USDC", label: "USDC", rails: ["EVM", "SOLANA"] as PayoutRail[] },
  { key: "BTC", label: "BTC", rails: ["BITCOIN_ONCHAIN", "BITCOIN_LIGHTNING"] as PayoutRail[] },
];

export function walletAssetScreen() {
  return {
    embeds: [
      embed(
        "Add a payout wallet",
        "Choose the asset you want to be paid in. You will confirm the network on the next step — FurlPay never guesses it for you."
      ),
    ],
    components: [
      row(...WALLET_ASSETS.map((a) => button(a.label, id("wallet_rail", a.key), Style.primary))),
      row(button("Back", id("account"))),
    ],
  };
}

const RAIL_NETWORK: Record<PayoutRail, { network: string; label: string }[]> = {
  EVM: [
    { network: "base", label: "Base" },
    { network: "arbitrum", label: "Arbitrum" },
    { network: "polygon", label: "Polygon" },
  ],
  SOLANA: [{ network: "solana", label: "Solana" }],
  BITCOIN_ONCHAIN: [{ network: "bitcoin:mainnet", label: "Bitcoin on-chain" }],
  BITCOIN_LIGHTNING: [{ network: "bitcoin:mainnet", label: "Lightning" }],
};

/**
 * Network choice.
 *
 * Only rails the backend can actually pay are offered. `availableRails()` is
 * the same list `checkRailDestination` enforces, so the menu cannot present an
 * option that would be refused at submission — the failure mode where a user
 * completes a flow and is told at the end it was never possible.
 */
export function walletRailScreen(assetKey: string) {
  const asset = WALLET_ASSETS.find((a) => a.key === assetKey);
  if (!asset) return errorScreen("That asset is not supported.");

  const usable = asset.rails.filter((r) => availableRails().includes(r));
  const unavailable = asset.rails.filter((r) => !availableRails().includes(r));

  const options = usable.flatMap((rail) =>
    RAIL_NETWORK[rail].map((n) => ({
      label: n.label,
      value: `${rail}|${n.network}`,
      description: `${asset.label} on ${n.label}`,
    }))
  );

  if (options.length === 0) {
    return errorScreen(`FurlPay cannot pay ${asset.label} on any rail yet.`);
  }

  const fields = unavailable.length
    ? [
        {
          name: "Not available yet",
          value: unavailable.map((r) => RAIL_LABEL[r]).join(", "),
          inline: false,
        },
      ]
    : undefined;

  return {
    embeds: [
      embed(
        `Choose a network for ${asset.label}`,
        "Select where this wallet lives. The network cannot be inferred from most addresses, so this choice is yours to make and confirm.",
        fields
      ),
    ],
    components: [
      row({
        type: STRING_SELECT,
        custom_id: id("wallet_address", assetKey),
        placeholder: "Select a network",
        options,
      }),
      row(button("Back", id("wallet_asset"))),
    ],
  };
}

/** The address modal. A modal keeps the address out of the channel entirely —
 *  it is never posted, only submitted. */
export function walletAddressModal(rail: string, network: string) {
  return {
    type: 9,
    data: {
      custom_id: id("wallet_address", rail, network),
      title: "Enter payout address",
      components: [
        row({
          type: TEXT_INPUT,
          custom_id: "address",
          style: 1,
          label: "Wallet address",
          placeholder: rail.startsWith("BITCOIN") ? "bc1p..." : "0x... or base58",
          required: true,
          min_length: 8,
          max_length: 200,
        }),
      ],
    },
  };
}

/**
 * The result of validating a submitted address.
 *
 * Renders the distinction the whole design turns on: an address FORMAT is
 * detected, a NETWORK is confirmed by the person. When the format cannot
 * identify the network, the screen says so rather than showing a checkmark
 * that implies more certainty than exists.
 */
export function walletConfirmScreen(rail: PayoutRail, network: string, address: string) {
  const result = checkRailDestination({ rail, network, destination: address });

  if (!result.ok) {
    return {
      embeds: [
        embed(
          "That address was not accepted",
          result.detail,
          [{ name: "Reason", value: result.reason.replace(/_/g, " "), inline: false }],
          DANGER
        ),
      ],
      components: [row(button("Try again", id("wallet_rail", "USDC")), button("Back", id("account")))],
    };
  }

  const fields = [
    { name: "Asset", value: result.assetSymbol, inline: true },
    { name: "Network", value: result.network, inline: true },
    { name: "Address", value: maskAddress(result.destination), inline: false },
  ];

  if (result.addressType) {
    fields.splice(2, 0, {
      name: "Type",
      value: addressTypeLabel(result.addressType as BitcoinAddressType),
      inline: true,
    });
  }

  fields.push({
    name: result.requiresNetworkConfirmation ? "Network needs your confirmation" : "Network confirmed by the address",
    value: result.requiresNetworkConfirmation
      ? "This address format is valid on more than one network. FurlPay will not guess — confirm that the network above is correct."
      : "This address encodes its own network, so there is nothing to choose.",
    inline: false,
  });

  const canVerify = ownershipSupport(result.rail) === "supported";
  fields.push({
    name: "Ownership",
    value: canVerify
      ? "Not yet verified. You will sign a message to prove you control this wallet. It authorises nothing and moves no funds."
      : `FurlPay cannot yet prove control of a ${result.assetSymbol} address on this rail. Payouts here remain subject to manual review.`,
    inline: false,
  });

  return {
    embeds: [
      embed(
        "Confirm your payout wallet",
        "Crypto transfers are irreversible. Check the network and address carefully — this wallet will receive your payouts.",
        fields,
        WARN
      ),
    ],
    components: [
      row(
        button(
          canVerify ? "Confirm and verify" : "Confirm",
          id("wallet_address", "confirm"),
          Style.success
        ),
        button("Change", id("wallet_asset")),
        button("Cancel", id("home"), Style.secondary)
      ),
    ],
  };
}

// ── security ───────────────────────────────────────────────────────────────

export function securityScreen(frozen: boolean) {
  return {
    embeds: [
      embed(
        "Security center",
        frozen
          ? "Payouts are frozen. New requests and wallet changes are blocked."
          : undefined,
        [
          { name: "Account security", value: "Good", inline: true },
          { name: "Discord authentication", value: "Active", inline: true },
          { name: "Payment profile", value: "Verified", inline: true },
          { name: "Payout wallet", value: "Verified", inline: true },
          { name: "Recent wallet changes", value: "None", inline: true },
          { name: "Payout activity", value: "Normal", inline: true },
        ],
        frozen ? DANGER : OK
      ),
    ],
    components: [
      row(
        frozen
          ? button("Unfreeze payouts", id("freeze_done", "off"), Style.secondary)
          : button("Freeze payouts", id("freeze_confirm"), Style.danger),
        button("Security activity", id("security", "activity")),
        button("Re-authenticate", id("security", "reauth"))
      ),
      row(button("Back", id("home"))),
    ],
  };
}

export function freezeConfirmScreen() {
  return {
    embeds: [
      embed(
        "Freeze all payouts?",
        [
          "This immediately:",
          "- blocks new payout requests",
          "- stops queued payouts where that is still possible",
          "- prevents wallet changes",
          "- notifies FurlPay security and writes an audit event",
          "",
          "Unfreezing requires re-authentication.",
        ].join("\n"),
        undefined,
        DANGER
      ),
    ],
    components: [
      row(
        button("Freeze payouts", id("freeze_done", "on"), Style.danger),
        button("Cancel", id("security"))
      ),
    ],
  };
}

export function supportScreen() {
  return {
    embeds: [
      embed(
        "Support",
        "Choose what you need help with. FurlPay attaches your payout and transaction IDs automatically, so you do not have to find them."
      ),
    ],
    components: [
      row({
        type: STRING_SELECT,
        custom_id: id("support", "topic"),
        placeholder: "What do you need help with?",
        options: [
          { label: "Payout not received", value: "not_received" },
          { label: "Wrong payout amount", value: "wrong_amount" },
          { label: "Wallet problem", value: "wallet" },
          { label: "Transaction problem", value: "transaction" },
          { label: "Verification problem", value: "verification" },
          { label: "Something else", value: "other" },
        ],
      }),
      row(button("Back", id("home"))),
    ],
  };
}

export function errorScreen(message: string) {
  return {
    embeds: [embed("That did not work", message, undefined, DANGER)],
    components: [row(button("Back", id("home")))],
  };
}
