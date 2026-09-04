import {
  accountScreen,
  ephemeral,
  replyOrUpdate,
  errorScreen,
  freezeConfirmScreen,
  homeScreen,
  id,
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
import { resolveDiscordAccount, type ResolvedIdentity } from "./identity";
import { completeStep, getState, isVerified, issueStepToken, nextStep, STEP_ORDER } from "./onboarding";
import { sendDm } from "./dm";
import { completeWalletStep } from "./onboarding";
import { issueChallenge, verifyOwnership } from "../ownership";
import { isDiscordAdmin, inspectDiscordUser, listDiscordUsers } from "./admin";

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
  /** The message the component was attached to. Discord sets flags here; bit
   *  64 means that message is already ephemeral. */
  message?: { flags?: number };
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

  // IDENTITY AND AUTHORIZATION, BEFORE ANY SCREEN IS BUILT.
  //
  // This resolves the Discord snowflake from the SIGNED interaction envelope —
  // never from a custom_id, which the client can edit — and provisions a
  // FurlPay account on first contact. A guild interaction must come from the
  // authorized guild; a DM is allowed and resolves to the same account, so one
  // person does not end up with two.
  const resolved = await resolveDiscordAccount(i);
  if (!resolved.ok) {
    return ephemeral({ content: resolved.detail });
  }
  const identity: ResolvedIdentity = resolved.identity;
  const userId = identity.account.user.id;

  const account = (loadAccount ? await loadAccount(identity.discordUserId) : null) ?? SPECIMEN;
  const unconfigured = loadAccount === null;

  // Where did the click come from? The public pinned message must never be
  // edited in place — see replyOrUpdate. Everything below routes through `nav`
  // rather than calling update() directly.
  const sourceIsEphemeral = ((i.message?.flags ?? 0) & 64) !== 0;
  const nav = (data: Record<string, unknown>) => replyOrUpdate(data, sourceIsEphemeral);

  // ── admin console, checked BEFORE the verification gate ─────────────
  //
  // Deliberately early. An unverified member probing the admin console must
  // be refused AS A NON-ADMIN and recorded as such — routing them into the
  // onboarding DM instead would answer the same for someone who is merely
  // new and for someone testing whether they can read other people's money,
  // and only one of those is worth an audit entry.
  if (parsed && (parsed.step === "admin_users" || parsed.step === "admin_user")) {
    const isEphemeralSource = ((i.message?.flags ?? 0) & 64) !== 0;
    const navAdmin = (data: Record<string, unknown>) => replyOrUpdate(data, isEphemeralSource);

    if (parsed.step === "admin_users") {
      const result = await listDiscordUsers(identity.discordUserId);
      if (!result.ok) return navAdmin(errorScreen(result.detail));
      return navAdmin({
        embeds: [
          {
            title: "FurlPay Discord users",
            description:
              result.value.length === 0
                ? "Nobody has onboarded through Discord yet."
                : result.value
                    .slice(0, 20)
                    .map(
                      (u) =>
                        `**${u.displayName}** — ${u.verification} (${u.completedSteps}/${u.totalSteps})` +
                        (u.walletMasked ? ` · ${u.walletMasked}` : " · no wallet")
                    )
                    .join("\n"),
            color: 0x5865f2,
            footer: { text: "Read-only. Every view is recorded in the audit trail." },
          },
        ],
      });
    }

    const result = await inspectDiscordUser(identity.discordUserId, parsed.args[0] ?? "");
    if (!result.ok) return navAdmin(errorScreen(result.detail));
    const u = result.value;
    return navAdmin({
      embeds: [
        {
          title: u.displayName,
          color: 0x5865f2,
          fields: [
            { name: "Verification", value: `${u.verification} (${u.completedSteps}/${u.totalSteps})`, inline: true },
            { name: "Wallet", value: u.walletMasked ?? "Not connected", inline: true },
            { name: "Email", value: u.emailMasked ?? "Not provided", inline: true },
          ],
          footer: { text: "Read-only. This view was recorded in the audit trail." },
        },
      ],
    });
  }

  // ── the verification gate ────────────────────────────────────────────
  //
  // Guild membership is not identity. Everything below this line can show
  // money, so nothing below runs until the member has proven, in their own
  // DM, that they are a person with a contactable email, a phone and a wallet
  // they control.
  const verification = await getState(identity.discordUserId);
  const verified = isVerified(verification);

  if (!verified) {
    // In the SERVER: say nothing financial, and move the conversation to a DM.
    // A public channel is the wrong place to conduct identity verification and
    // the wrong place to mention that somebody has an account at all.
    if (identity.origin.kind === "guild") {
      const dm = await sendDm(identity.discordUserId, verificationDm(verification));
      if (!dm.ok && dm.reason === "dms_disabled") {
        return ephemeral({
          content: [
            "FurlPay could not send you a direct message.",
            "",
            "Open **Privacy Settings** for this server and allow direct messages, then run `/payments` again.",
            "Your account details are never posted in a public channel, which is why this has to happen in a DM.",
          ].join("\n"),
        });
      }
      if (!dm.ok) {
        return ephemeral({ content: "FurlPay could not start verification just now. Try again shortly." });
      }
      return ephemeral({
        content: "Check your direct messages — FurlPay has sent you a private verification step.",
      });
    }

    // Already IN the DM: render the next step inline.
    return ephemeral(verificationDm(verification));
  }

  // The slash command posts a fresh private console.
  if (isCommand) {
    const screen = withNotice(homeScreen(account), unconfigured);
    if (identity.created) {
      // Said once, privately, on first contact. The channel never learns that
      // an account was created — that is nobody else's business.
      const embeds = (screen.embeds as Record<string, unknown>[]) ?? [];
      return ephemeral({
        ...screen,
        embeds: [
          {
            title: "Your FurlPay account is ready",
            description:
              "This console is private to you. Nobody else in the server can see it.",
            color: 0x2ecc71,
          },
          ...embeds,
        ],
      });
    }
    return ephemeral(screen);
  }

  const { step, args } = parsed!;

  switch (step) {
    case "home":
      return nav(withNotice(homeScreen(account), unconfigured));

    case "account":
      return nav(
        accountScreen({
          status: "Active",
          country: "Not set",
          verification: "Pending",
          paymentStatus: account.payoutsFrozen ? "Frozen" : "Enabled",
        })
      );

    case "wallet_asset":
      return nav(walletAssetScreen());

    case "wallet_rail":
      return nav(walletRailScreen(args[0] ?? ""));

    case "wallet_address":
      return walletAddressStep(i, args, sourceIsEphemeral);

    case "security":
      return nav(securityScreen(account.payoutsFrozen));

    case "freeze_confirm":
      return nav(freezeConfirmScreen());

    case "freeze_done": {
      const on = args[0] === "on";
      // The audit entry is written whether or not a ledger is wired: a freeze
      // is a security event, and the record of someone asking for one is
      // useful even before it can be enforced.
      audit(on ? "payout.freeze_requested" : "payout.unfreeze_requested", userId, {
        source: "discord",
      });
      return nav(
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

    // ── verification steps ──────────────────────────────────────────
    // Each opens a modal. The token id travels in the modal custom_id, but
    // it authorises nothing on its own: completeStep re-checks that the
    // token was issued to THIS Discord user before it looks at the answer.
    case "verify_captcha":
    case "verify_email":
    case "verify_phone": {
      const which = step === "verify_captcha" ? "captcha" : step === "verify_email" ? "email" : "phone";
      const submitted = i.data?.components?.[0]?.components?.[0]?.value?.trim();

      if (submitted && args[0]) {
        const result = await completeStep({
          tokenId: args[0],
          discordUserId: identity.discordUserId,
          answer: submitted,
        });
        if (!result.ok) {
          return nav({
            embeds: [{ title: "Not verified", description: result.detail, color: 0xed4245 }],
          });
        }
        return nav(verificationDm(result.state));
      }

      const token = await issueStepToken(identity.discordUserId, which);
      return {
        type: 9,
        data: {
          custom_id: id(step, token.id),
          title: which === "captcha" ? "Verify you are a person" : `Confirm your ${which}`,
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: "answer",
                  style: 1,
                  label: which === "captcha" ? `Enter this code: ${token.secret}` : "Enter the code we sent you",
                  required: true,
                  min_length: 6,
                  max_length: 6,
                },
              ],
            },
          ],
        },
      };
    }

    case "support":
      return nav(supportScreen());

    case "earnings":
    case "payout":
    case "crypto":
      // Declared but not yet backed by an engine. Saying so is the honest
      // option; a screen of plausible numbers would be indistinguishable from
      // a working one.
      return nav(
        errorScreen(
          `${step === "payout" ? "Payouts" : step === "earnings" ? "Earnings" : "Crypto networks"} are not connected to the ledger on this deployment yet.`
        )
      );

    default:
      return nav(errorScreen("That screen is not available."));
  }
}

/**
 * Address entry: opens a modal, or validates what the modal returned.
 *
 * The rail and network arrive from a select menu the client controls, so both
 * are checked against `availableRails()` before anything is done with them.
 */
function walletAddressStep(i: ConsoleInteraction, args: string[], sourceIsEphemeral: boolean): Reply {
  const nav = (data: Record<string, unknown>) => replyOrUpdate(data, sourceIsEphemeral);
  // Path 1: a select menu chose "RAIL|network" — open the modal.
  const selected = i.data?.values?.[0];
  if (selected) {
    const [rail, network] = selected.split("|");
    if (!isUsableRail(rail)) return nav(errorScreen("That network is not available for payouts."));
    return walletAddressModal(rail, network ?? "");
  }

  // Path 2: the modal came back with an address.
  const address = i.data?.components?.[0]?.components?.[0]?.value?.trim();
  if (address) {
    const [rail, network] = args;
    if (!isUsableRail(rail)) return nav(errorScreen("That network is not available for payouts."));
    return nav(walletConfirmScreen(rail, network ?? "", address));
  }

  // Path 3: the confirm button. The wallet is not stored yet — persistence and
  // the ownership challenge are the next commit, and pretending otherwise
  // would leave someone believing their payout destination was saved.
  return nav(
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

/**
 * The private verification screen.
 *
 * Shows only the NEXT step. A checklist of four demands at once reads as a
 * wall and gets abandoned; one question at a time is finishable.
 */
function verificationDm(state: Awaited<ReturnType<typeof getState>>): Record<string, unknown> {
  const step = nextStep(state);
  const done = state.completed.length;
  const total = STEP_ORDER.length;

  const copy: Record<string, { title: string; body: string; label: string; id: string }> = {
    captcha: {
      title: "Verify you are a person",
      body: "Enter the code shown to continue. This keeps automated accounts out of the payout system.",
      label: "Enter code",
      id: id("verify_captcha"),
    },
    email: {
      title: "Confirm your email",
      body: "FurlPay sends receipts and recovery here. We will email you a six-character code.",
      label: "Add email",
      id: id("verify_email"),
    },
    phone: {
      title: "Confirm your phone",
      body: "A second factor for anything that moves money. We will text you a six-character code.",
      label: "Add phone",
      id: id("verify_phone"),
    },
    wallet: {
      title: "Connect your payout wallet",
      body: [
        "Sign a message with the wallet that will receive your payouts. The signature proves you control it.",
        "",
        "FurlPay will never ask for your seed phrase, private key or recovery phrase.",
      ].join("\n"),
      label: "Connect wallet",
      id: id("wallet_asset"),
    },
  };

  if (!step) {
    return {
      embeds: [{ title: "Verification complete", description: "Run /payments to open your account.", color: 0x2ecc71 }],
    };
  }

  const c = copy[step];
  return {
    embeds: [
      {
        title: c.title,
        description: c.body,
        color: 0x5865f2,
        fields: [{ name: "Progress", value: `Step ${done + 1} of ${total}`, inline: true }],
        footer: { text: "FurlPay Payments — this conversation is private to you" },
      },
    ],
    components: [{ type: 1, components: [{ type: 2, style: 1, label: c.label, custom_id: c.id }] }],
  };
}