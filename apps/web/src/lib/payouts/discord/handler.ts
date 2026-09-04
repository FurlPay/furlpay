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
import { completeStep, completeWalletStep, getState, isVerified, issueStep, nextStep, STEP_ORDER } from "./onboarding";
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
    // VERIFICATION HAPPENS HERE, EPHEMERALLY — IT DOES NOT HAPPEN IN A DM.
    //
    // This used to open a DM and tell the member to go and read it. Two
    // separate things were wrong with that.
    //
    // OPERATIONALLY: it made the gate depend on a bot token being present and
    // on the member accepting DMs from server bots. In production the token
    // was absent — it lived only in a gitignored .env.local — so every single
    // attempt answered "could not start verification just now" and nobody
    // could get past the first screen. A gate that fails closed on a missing
    // credential is correct; a gate that fails closed for everyone because of
    // one is just broken.
    //
    // SECURITY: an unsolicited bot DM is the exact shape of a Discord wallet
    // drainer, which is why Discord now attaches phishing warnings to them and
    // why the established verification bots advertise that they never DM
    // first. Teaching members to expect a payments DM from us is teaching them
    // to trust the next one, which will not be from us.
    //
    // An ephemeral reply gives the same privacy — only this member can see it,
    // whether it was triggered in a channel or in a DM — with none of that. It
    // also works for members who have DMs disabled, which since Discord's
    // teen-account default is a large share of them.
    //
    // dm.ts is kept, but demoted: it is for telling someone their payout left,
    // never for gating their access.
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
    //
    // Two stages for email and phone: the member gives an address, a code is
    // sent THERE, and only then are they asked for it. The previous shape
    // asked for "the code we sent you" without ever having asked where to
    // send it — there was no address, so there was no code, and the step was
    // uncompletable.
    case "verify_captcha":
    case "verify_email":
    case "verify_phone": {
      const which = step === "verify_captcha" ? "captcha" : step === "verify_email" ? "email" : "phone";
      const submitted = i.data?.components?.[0]?.components?.[0]?.value?.trim();

      // Stage 2: a code came back against a token id.
      if (submitted && args[0] && args[0] !== "ask") {
        const result = await completeStep({
          tokenId: args[0],
          discordUserId: identity.discordUserId,
          answer: submitted,
        });
        if (!result.ok) {
          const left = result.reason === "incorrect" && result.attemptsLeft !== undefined
            ? ` ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left.`
            : "";
          return nav({ embeds: [{ title: "Not verified", description: result.detail + left, color: 0xed4245 }] });
        }
        return nav(verificationDm(result.state));
      }

      // Stage 1 for email and phone: ask WHERE to send the code.
      if (which !== "captcha" && !submitted) {
        return {
          type: 9,
          data: {
            custom_id: id(step, "ask"),
            title: which === "email" ? "Confirm your email" : "Confirm your phone",
            components: [
              {
                type: 1,
                components: [
                  {
                    type: 4,
                    custom_id: "destination",
                    style: 1,
                    label: which === "email" ? "Email address" : "Phone number, with country code",
                    placeholder: which === "email" ? "you@example.com" : "+44 7700 900000",
                    required: true,
                    min_length: 5,
                    max_length: 254,
                  },
                ],
              },
            ],
          },
        };
      }

      // Stage 1 result, or the captcha: mint a token and, for email, send it.
      const destination = which === "captcha" ? undefined : submitted;
      const issued = await issueStep(identity.discordUserId, which, destination);
      if (!issued.ok) {
        return nav({ embeds: [{ title: "Not sent", description: issued.detail, color: 0xed4245 }] });
      }

      // HONEST ABOUT DELIVERY. sendEmail degrades to a console log when no
      // provider key is set — right for a newsletter, wrong here, because a
      // member cannot read a server log and would wait for a code that was
      // never sent.
      if (issued.delivered === "not_delivered") {
        return nav({
          embeds: [
            {
              title: which === "phone" ? "Phone verification unavailable" : "Email could not be sent",
              description:
                which === "phone"
                  ? "FurlPay has no SMS provider configured on this deployment, so this step cannot be completed yet."
                  : "FurlPay has no email provider configured on this deployment, so the code could not be delivered.",
              color: 0xf1c40f,
            },
          ],
        });
      }

      return {
        type: 9,
        data: {
          custom_id: id(step, issued.token.id),
          title: which === "captcha" ? "Verify you are a person" : "Enter your code",
          components: [
            {
              type: 1,
              components: [
                {
                  type: 4,
                  custom_id: "answer",
                  style: 1,
                  label:
                    which === "captcha"
                      ? `Enter this code: ${issued.token.secret}`
                      : `Enter the code sent to ${destination}`,
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


    case "wallet_proof":
      return walletProofStep(
        identity,
        args,
        i.data?.components?.[0]?.components?.[0]?.value?.trim(),
        nav
      );

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

  // Path 3: confirm. Validation established the address is well-formed and
  // correctly paired with its network. It established NOTHING about who
  // controls it, so the flow moves to a signature rather than saving.
  return nav({
    embeds: [
      {
        title: "Prove you control this wallet",
        description: [
          "Sign a short message with this wallet. The signature proves control; it authorises nothing and moves no funds.",
          "",
          "FurlPay will never ask for your seed phrase, private key or recovery phrase.",
        ].join("\n"),
        color: 0x5865f2,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 1, label: "Get signing message", custom_id: id("wallet_proof", "start") },
        ],
      },
    ],
  });
}

/**
 * Prove control of a payout address, then record it.
 *
 * Two stages. A challenge is issued and shown; the member signs it in their own
 * wallet and pastes the signature back. It is verified against the address by
 * the payouts ownership module — EIP-191 for EVM, Ed25519 for Solana — before
 * anything is written.
 *
 * THE ADDRESS IS NEVER TAKEN ON TRUST. It arrives from a client-controlled
 * modal, so it is a claim until the recovered signer matches it.
 */
async function walletProofStep(
  identity: ResolvedIdentity,
  args: string[],
  submitted: string | undefined,
  nav: (data: Record<string, unknown>) => Reply
): Promise<Reply> {
  // Stage 2: a signature came back against a challenge id.
  if (submitted && args[0] === "sig" && args[1]) {
    const result = await verifyOwnership({
      challengeId: args[1],
      userId: identity.discordUserId,
      address: args[2] ?? "",
      signature: submitted,
    });
    if (!result.ok) {
      return nav({
        embeds: [{ title: "Not verified", description: result.detail, color: 0xed4245 }],
      });
    }
    // Only now, with the signer recovered and matched, is the address recorded.
    const state = await completeWalletStep(identity.discordUserId, result.address);
    return nav({
      embeds: [
        {
          title: "Wallet connected",
          description: "This wallet is now linked to your FurlPay account.",
          color: 0x2ecc71,
          fields: [
            { name: "Wallet", value: maskWallet(result.address), inline: true },
            { name: "Ownership", value: "Verified by signature", inline: true },
          ],
        },
      ],
      components: isVerified(state)
        ? [{ type: 1, components: [{ type: 2, style: 1, label: "Open payments", custom_id: id("home") }] }]
        : undefined,
    });
  }

  return nav({
    embeds: [
      {
        title: "Wallet signing is not enabled on this deployment",
        description:
          "The signature verifier is implemented and tested, but the wallet-selection handoff is not yet connected here. Nothing was saved.",
        color: 0xf1c40f,
      },
    ],
  });
}

/** Enough of an address to recognise, not enough to reuse. */
function maskWallet(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}${"•".repeat(6)}${address.slice(-4)}`;
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