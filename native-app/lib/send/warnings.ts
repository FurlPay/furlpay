import { shortAddress, usd } from "@/lib/format";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { bySeverity, type MoneyWarning } from "@/lib/warnings";
import type { RecentRecipient } from "./lookalike";

// ---------------------------------------------------------------------------
// What a user should be told BEFORE the swipe, for a send.
//
// The swap screen's warnings are about price; a send has no price, so these are
// about the two things that actually go wrong with an outbound transfer:
// the address is not who you think it is, and the amount is larger than you
// meant. Both are irreversible.
//
// DELIBERATELY OMITTED: a standing "sends are irreversible" banner. It would be
// on screen for every send, and a warning that is always present is furniture —
// users stop reading it, including the day it matters. Irreversibility is
// stated once, in the review summary next to the address it applies to.
// ---------------------------------------------------------------------------

/** Above this, a send is large enough to warrant an explicit heads-up. */
export const LARGE_SEND_USD = 10_000;

export function sendWarnings(input: {
  amountUsd: number;
  destination: string;
  chain: ChainId;
  token: string;
  /** True when this exact address is already in the user's history. */
  known: boolean;
  /** A trusted address that renders identically to this one, if any. */
  lookalike?: RecentRecipient;
  /** Whether the address is well-formed; nothing below applies if it is not. */
  addressValid: boolean;
}): MoneyWarning[] {
  const out: MoneyWarning[] = [];
  if (!input.addressValid) return out;

  // The most dangerous thing this screen can encounter, so it is the only
  // danger-level warning: the user is about to pay an address that was built to
  // be mistaken for one of theirs.
  if (input.lookalike) {
    out.push({
      id: "lookalike",
      level: "danger",
      title: "This looks like an address you've used — but it isn't",
      detail: `You previously sent to ${shortAddress(input.lookalike.address, 6)}, which shortens to the same thing as this address but is a different address. This is exactly how address-poisoning scams work. Compare every character before continuing.`,
    });
  } else if (!input.known) {
    out.push({
      id: "first_time",
      level: "warn",
      title: "First time sending here",
      detail:
        "You haven't sent to this address before. If you're unsure, send a small amount first and confirm it arrives.",
    });
  }

  if (input.amountUsd >= LARGE_SEND_USD) {
    out.push({
      id: "large_send",
      level: "warn",
      title: "Large payment",
      detail: `${usd(input.amountUsd)} on ${CHAINS[input.chain].name}. Once the network confirms it, no one — including FurlPay — can reverse it.`,
    });
  }

  return bySeverity(out);
}
