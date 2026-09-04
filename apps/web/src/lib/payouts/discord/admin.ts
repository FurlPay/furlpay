import { audit } from "../../audit";
import { getState, type VerificationState } from "./onboarding";
import { listAccounts } from "../../store";
import { maskAddress } from "../address";

// ---------------------------------------------------------------------------
// The FurlPay admin console for Discord.
//
// DISCORD ADMINISTRATOR IS NOT FURLPAY AUTHORIZATION. The bot holds Discord
// Administrator so it can create channels and pin messages; that is an
// operational capability inside one chat product. It says nothing about who
// may read another person's balance, and a server owner is not automatically
// entitled to their members' financial records. The two are separate security
// domains and this module never consults Discord roles or permissions.
//
// Authorization is an explicit allowlist of snowflakes, configured server-side
// in FURLPAY_DISCORD_ADMINS. A client cannot claim membership of it: the id
// checked is the one from the Ed25519-signed interaction envelope, and the
// list is never sent to the client in any form.
//
// READ-ONLY, AND NOT IMPERSONATION. There is no "act as user" path here. An
// admin gets an AdminUserView — a deliberately narrow projection — rather than
// a session, an account object, or anything that could be passed to code
// expecting an authenticated owner. Addresses are masked and no secret,
// verification code or token is ever included.
//
// EVERY READ IS AUDITED. Looking at someone's money is an event, not a
// non-event: the trail records who looked, at whom, and at what.
// ---------------------------------------------------------------------------

/**
 * Snowflakes explicitly authorised to use the admin console.
 *
 * Read on every call rather than cached, so revoking an admin takes effect on
 * the next interaction instead of at the next deploy.
 */
/** Users per admin page. Bounded so the response fits Discord's three-second
 *  window however many members the server has. */
const PAGE_SIZE = 20;

export function adminSnowflakes(): string[] {
  return (process.env.FURLPAY_DISCORD_ADMINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{17,20}$/.test(s));
}

/**
 * Is this Discord user a FurlPay admin?
 *
 * Takes the snowflake ONLY. It deliberately accepts no interaction, member or
 * permission object, so there is no parameter through which Discord's own
 * notion of "administrator" could leak into the decision.
 */
export function isDiscordAdmin(discordUserId: string): boolean {
  const list = adminSnowflakes();
  return list.length > 0 && list.includes(discordUserId);
}

/** The narrow projection an admin may see. No balances beyond what the
 *  account already exposes, no addresses in full, nothing secret. */
export interface AdminUserView {
  furlpayUserId: string;
  discordUserId: string;
  displayName: string;
  verification: VerificationState["status"];
  completedSteps: number;
  totalSteps: number;
  /** Masked. An admin needs to recognise a wallet, not to reuse it. */
  walletMasked: string | null;
  /** Present only if the member proved it. Contact detail, not a credential. */
  emailMasked: string | null;
  createdAt: string;
}

export type AdminResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_admin" | "not_configured" | "not_found"; detail: string };

function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split("@");
  if (!domain) return null;
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/**
 * Every Discord-onboarded user, for the admin list screen.
 *
 * The authorization check is the first statement, before any data is read, so
 * an unauthorised call cannot even cause a lookup — a timing difference
 * between "no such data" and "not allowed" is a small leak, but it is a leak.
 */
export async function listDiscordUsers(
  actorDiscordUserId: string
): Promise<AdminResult<AdminUserView[]>> {
  if (adminSnowflakes().length === 0) {
    return {
      ok: false,
      reason: "not_configured",
      detail: "No FurlPay Discord admins are configured on this deployment.",
    };
  }
  if (!isDiscordAdmin(actorDiscordUserId)) {
    audit("admin.access_denied", actorDiscordUserId, { surface: "discord", action: "list_users" });
    return { ok: false, reason: "not_admin", detail: "You are not a FurlPay administrator." };
  }

  // PAGED AND PARALLEL. Discord closes the interaction window at three
  // seconds, and the previous shape awaited one KV read per user inside a
  // loop — fifty members meant fifty sequential round trips and a guaranteed
  // timeout. The page cap bounds the work regardless of how large the server
  // grows; Promise.all makes the reads concurrent rather than serial.
  const accounts = listAccounts()
    .filter((a) => a.user.discordUserId)
    .slice(0, PAGE_SIZE);

  const views: AdminUserView[] = await Promise.all(
    accounts.map(async (account) => {
      const discordUserId = account.user.discordUserId!;
      const state = await getState(discordUserId);
      return {
      furlpayUserId: account.user.id,
      discordUserId,
      displayName: account.user.name,
      verification: state.status,
      completedSteps: state.completed.length,
      totalSteps: 4,
      walletMasked: state.walletAddress ? maskAddress(state.walletAddress) : null,
      emailMasked: maskEmail(state.email),
        createdAt: state.startedAt,
      };
    })
  );

  audit("admin.users_listed", actorDiscordUserId, { surface: "discord", count: views.length });
  return { ok: true, value: views };
}

/**
 * One user, for the admin detail screen.
 *
 * The target is named by the caller, which is why the audit entry records both
 * sides: an admin looking at one specific person is exactly the event worth
 * being able to reconstruct later.
 */
export async function inspectDiscordUser(
  actorDiscordUserId: string,
  targetDiscordUserId: string
): Promise<AdminResult<AdminUserView>> {
  if (!isDiscordAdmin(actorDiscordUserId)) {
    audit("admin.access_denied", actorDiscordUserId, {
      surface: "discord",
      action: "inspect_user",
      target: targetDiscordUserId,
    });
    return { ok: false, reason: "not_admin", detail: "You are not a FurlPay administrator." };
  }

  const account = listAccounts().find((a) => a.user.discordUserId === targetDiscordUserId);
  if (!account) {
    return { ok: false, reason: "not_found", detail: "No FurlPay account for that Discord user." };
  }

  const state = await getState(targetDiscordUserId);

  audit("admin.user_inspected", actorDiscordUserId, {
    surface: "discord",
    targetFurlpayUserId: account.user.id,
    targetDiscordUserId,
    resourceType: "account",
  });

  return {
    ok: true,
    value: {
      furlpayUserId: account.user.id,
      discordUserId: targetDiscordUserId,
      displayName: account.user.name,
      verification: state.status,
      completedSteps: state.completed.length,
      totalSteps: 4,
      walletMasked: state.walletAddress ? maskAddress(state.walletAddress) : null,
      emailMasked: maskEmail(state.email),
      createdAt: state.startedAt,
    },
  };
}
