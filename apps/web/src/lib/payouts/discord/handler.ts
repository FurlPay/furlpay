import {
  accountScreen,
  ephemeral,
  errorScreen,
  freezeConfirmScreen,
  homeScreen,
  parseId,
  securityScreen,
  supportScreen,
  update,
  walletAddressModal,
  walletAssetScreen,
  walletConfirmScreen,
  walletRailScreen,
  type ConsoleAccount,
} from "./console";
import { availableRails, type PayoutRail } from "../rails";
import { audit } from "../../audit";

// ---------------------------------------------------------------------------
// Payments console router.
//
// Follows the repository's handler convention: return `null` when the
// interaction is not ours so the next handler in the chain gets a look. A
// handler that claims everything is how one feature silently breaks another.
//
// EVERYTHING HERE IS UNTRUSTED INPUT. `custom_id` and select `values` come
// back from the client and can be edited by anyone with a proxy. The rail and
// network are therefore re-validated against the backend's own list on every
// hop rather than trusted because "the menu only offered valid ones".
//
// Discord requires a response within three seconds. Nothing in this path does
// I/O beyond a KV read, so every screen answers synchronously; anything slower
// belongs behind a deferred response and a worker, not here.
// ---------------------------------------------------------------------------

export interface ConsoleInteraction {
  type: number;
  guild_id?: string;
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
  data?: {
    name?: string;
    custom_id?: string;
    values?: string[];
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
}

type Reply = { type: number; data?: Record<string, unknown> };

/** Loader for the account behind a Discord user. Injected so the router stays
 *  testable and so the ledger is never reached from view code. */
export type AccountLoader = (discordUserId: string) => Promise<ConsoleAccount | null>;

/**
 * A specimen account, used only when no loader is configured.
 *
 * It is clearly marked in the reply so nobody mistakes it for their balance.
 * The alternative — showing zeroes — is worse: it looks like a real answer and
 * would have people opening support tickets about missing money.
 */
const SPECIMEN: ConsoleAccount = {
  availableAtomic: "0",
  pendingAtomic: "0",
  lifetimeAtomic: "0",
  decimals: 6,
  currency: "USDC",
  lastPayout: null,
  payoutsFrozen: false,
};

let loadAccount: AccountLoader | null = null;

/** Wire the console to a real ledger. Until this is called the console runs in
 *  a read-only, no-balance mode rather than inventing numbers. */
export function setAccountLoader(loader: AccountLoader): void {
  loadAccount = loader;
}

function actorId(i: ConsoleInteraction): string | null {
  return i.member?.user?.id ?? i.user?.id ?? null;
}

/**
 * Handle a payments-console interaction.
 *
 * Returns null when the custom_id belongs to another feature.
 */
export async function handlePaymentsConsole(i: ConsoleInteraction): Promise<Reply | null> {
  const customId = i.data?.custom_id ?? "";
  const isCommand = i.data?.name === "payments";
  const parsed = parseId(customId);
  if (!isCommand && !parsed) return null;

  const userId = actorId(i);
  if (!userId) {
    // Every screen here is account-scoped. Without an identity there is
    // nothing correct to show, and a generic screen would imply otherwise.
    return ephemeral({
      content: "Open this inside the FurlPay server so it can find your payment account.",
    });
  }

  const account = (loadAccount ? await loadAccount(userId) : null) ?? SPECIMEN;
  const unconfigured = loadAccount === null;

  // The slash command posts a fresh private console.
  if (isCommand) {
    return ephemeral(withNotice(homeScreen(account), unconfigured));
  }

  const { step, args } = parsed!;

  switch (step) {
    case "home":
      return update(withNotice(homeScreen(account), unconfigured));

    case "account":
      return update(
        accountScreen({
          status: "Active",
          country: "Not set",
          verification: "Pending",
          paymentStatus: account.payoutsFrozen ? "Frozen" : "Enabled",
        })
      );

    case "wallet_asset":
      return update(walletAssetScreen());

    case "wallet_rail":
      return update(walletRailScreen(args[0] ?? ""));

    case "wallet_address":
      return walletAddressStep(i, args);

    case "security":
      return update(securityScreen(account.payoutsFrozen));

    case "freeze_confirm":
      return update(freezeConfirmScreen());

    case "freeze_done": {
      const on = args[0] === "on";
      // The audit entry is written whether or not a ledger is wired: a freeze
      // is a security event, and the record of someone asking for one is
      // useful even before it can be enforced.
      audit(on ? "payout.freeze_requested" : "payout.unfreeze_requested", userId, {
        source: "discord",
      });
      return update(
        on
          ? {
              embeds: [
                {
                  title: "Payouts frozen",
                  description:
                    "New payout requests and wallet changes are blocked. Unfreezing requires re-authentication.",
                  color: 0xed4245,
                  footer: { text: "FurlPay Payments" },
                },
              ],
              components: securityScreen(true).components,
            }
          : securityScreen(false)
      );
    }

    case "support":
      return update(supportScreen());

    case "earnings":
    case "payout":
    case "crypto":
      // Declared but not yet backed by an engine. Saying so is the honest
      // option; a screen of plausible numbers would be indistinguishable from
      // a working one.
      return update(
        errorScreen(
          `${step === "payout" ? "Payouts" : step === "earnings" ? "Earnings" : "Crypto networks"} are not connected to the ledger on this deployment yet.`
        )
      );

    default:
      return update(errorScreen("That screen is not available."));
  }
}

/**
 * Address entry: opens a modal, or validates what the modal returned.
 *
 * The rail and network arrive from a select menu the client controls, so both
 * are checked against `availableRails()` before anything is done with them.
 */
function walletAddressStep(i: ConsoleInteraction, args: string[]): Reply {
  // Path 1: a select menu chose "RAIL|network" — open the modal.
  const selected = i.data?.values?.[0];
  if (selected) {
    const [rail, network] = selected.split("|");
    if (!isUsableRail(rail)) return update(errorScreen("That network is not available for payouts."));
    return walletAddressModal(rail, network ?? "");
  }

  // Path 2: the modal came back with an address.
  const address = i.data?.components?.[0]?.components?.[0]?.value?.trim();
  if (address) {
    const [rail, network] = args;
    if (!isUsableRail(rail)) return update(errorScreen("That network is not available for payouts."));
    return update(walletConfirmScreen(rail, network ?? "", address));
  }

  // Path 3: the confirm button. The wallet is not stored yet — persistence and
  // the ownership challenge are the next commit, and pretending otherwise
  // would leave someone believing their payout destination was saved.
  return update(
    errorScreen(
      "Wallet storage is not enabled on this deployment yet. The address was validated but not saved."
    )
  );
}

function isUsableRail(rail: string | undefined): rail is PayoutRail {
  return !!rail && (availableRails() as string[]).includes(rail);
}

/** Append a one-line notice when the console has no ledger behind it, so a
 *  zero balance is never mistaken for a real one. */
function withNotice(screen: Record<string, unknown>, unconfigured: boolean): Record<string, unknown> {
  if (!unconfigured) return screen;
  const embeds = (screen.embeds as Record<string, unknown>[]) ?? [];
  return {
    ...screen,
    embeds: [
      ...embeds,
      {
        description:
          "This deployment has no payment ledger connected, so balances read zero. They are not your real balances.",
        color: 0xf1c40f,
      },
    ],
  };
}
