import { findOrCreateUserByIdentityDurable } from "../../store";
import type { UserAccount } from "../../store";
import { audit } from "../../audit";

// ---------------------------------------------------------------------------
// Discord identity → FurlPay account.
//
// THE INVARIANT: one Discord user is one FurlPay account, wherever they click.
// The server and a DM are the same person, so both resolve through the same
// key and neither can create a second account for someone who already has one.
//
// THE KEY IS THE SNOWFLAKE, NEVER THE USERNAME. Discord usernames are
// renameable and, once released, claimable by somebody else — keying identity
// on one would eventually hand an account to whoever took the handle next.
// Nicknames are worse still: they are per-guild and set by moderators.
//
// GUILD IS AUTHORIZATION, NOT IDENTITY. Which server someone clicked in
// decides whether they may act at all; it does not decide who they are. Baking
// the guild into the identity key would give the same human two accounts —
// one from the server, one from their DMs — and split their money across both.
//
// Nothing here trusts a custom_id. The Discord user id used below comes from
// the interaction envelope, which arrives inside an Ed25519-signed request
// that the route verifies before this module is ever reached. Component
// payloads are client-editable; the envelope is not.
// ---------------------------------------------------------------------------

/** The one guild whose members may use the payments console. */
export function authorizedGuildId(): string | null {
  const id = process.env.DISCORD_GUILD_ID?.trim();
  return id && /^\d{17,20}$/.test(id) ? id : null;
}

export type Origin =
  /** Inside a guild. `guildId` is present and must match. */
  | { kind: "guild"; guildId: string }
  /** A direct message. Discord sends no guild_id at all. */
  | { kind: "dm" };

export type AccessDecision =
  | { ok: true; origin: Origin }
  | { ok: false; reason: "wrong_guild" | "no_identity"; detail: string };

/**
 * May this interaction use the console, and where did it come from?
 *
 * A DM carries no `guild_id`. That absence is the signal — it must not be
 * defaulted to the authorized guild, because doing so would let an
 * interaction forged without a guild inherit guild-member privileges.
 */
export function classifyOrigin(i: {
  guild_id?: string;
  member?: { user?: { id?: string } };
  user?: { id?: string };
}): AccessDecision {
  const discordUserId = i.member?.user?.id ?? i.user?.id;
  if (!discordUserId) {
    return {
      ok: false,
      reason: "no_identity",
      detail: "This interaction carried no Discord user.",
    };
  }

  if (i.guild_id === undefined) {
    // A DM. `member` is absent here and `user` is populated instead, which is
    // why both are read above.
    return { ok: true, origin: { kind: "dm" } };
  }

  const authorized = authorizedGuildId();
  if (authorized && i.guild_id !== authorized) {
    // Another server added this bot. Its members are not FurlPay members, and
    // resolving them into accounts would let any server mint FurlPay users.
    return {
      ok: false,
      reason: "wrong_guild",
      detail: "The FurlPay payments console is not available in this server.",
    };
  }
  return { ok: true, origin: { kind: "guild", guildId: i.guild_id } };
}

export interface ResolvedIdentity {
  account: UserAccount;
  /** True when this call provisioned the account. Drives the onboarding copy. */
  created: boolean;
  discordUserId: string;
  origin: Origin;
}

export type ResolveResult =
  | { ok: true; identity: ResolvedIdentity }
  | { ok: false; reason: string; detail: string };

/**
 * Resolve — and, on first contact, provision — the account behind an
 * interaction.
 *
 * Provisioning goes through `findOrCreateUserByIdentityDurable`, the same path
 * every other login uses, rather than a Discord-specific account table. A
 * parallel ledger keyed on Discord ids would be a second source of truth for
 * the same person's money, and the two would drift the first time someone also
 * signed in on the web.
 *
 * `findOrCreate` is atomic against the durable unique index, so two clicks
 * landing at once cannot produce two accounts.
 */
export async function resolveDiscordAccount(i: {
  guild_id?: string;
  member?: { user?: { id?: string; username?: string } };
  user?: { id?: string; username?: string };
}): Promise<ResolveResult> {
  const access = classifyOrigin(i);
  if (!access.ok) return { ok: false, reason: access.reason, detail: access.detail };

  const discordUserId = (i.member?.user?.id ?? i.user?.id)!;
  // The username is carried only so a freshly created account has something
  // human-readable on it. It is never a lookup key — see the header.
  const username = i.member?.user?.username ?? i.user?.username;

  const { account, created } = await findOrCreateUserByIdentityDurable({
    discordUserId,
    name: username ?? "FurlPay member",
    authProvider: undefined,
  });

  if (created) {
    audit("account.discord_provisioned", account.user.id, {
      discordUserId,
      origin: access.origin.kind,
    });
  }

  return { ok: true, identity: { account, created, discordUserId, origin: access.origin } };
}

/**
 * Does `account` belong to the Discord user who sent this interaction?
 *
 * Used before any operation that names a resource. The rule this enforces:
 * a button, a modal value or a custom_id is a REQUEST, never an
 * authorization — ownership is re-derived from the signed envelope on every
 * sensitive call, not carried along from the click that started the flow.
 */
export function ownsAccount(identity: ResolvedIdentity, accountUserId: string): boolean {
  return identity.account.user.id === accountUserId;
}
