// ---------------------------------------------------------------------------
// Discord REST for role reads and writes.
//
// SELF-CONTAINED, like priceCards/discordBot.ts and discordWelcome/rest.ts.
// Those are working production paths and this change does not touch them; the
// cost is two small duplicated helpers, and the benefit is that a mistake here
// cannot break the daily price cards. If a fourth Discord consumer appears,
// that is the moment to extract a shared client rather than now.
//
// THE TOKEN NEVER APPEARS IN A RETURN VALUE. Same rule as the other two: every
// error is built from a status code and a fixed string, so no response body can
// carry a credential into a log or an issue.
//
// ── ROLE HIERARCHY IS THE FAILURE MODE THAT SURPRISES PEOPLE ───────────────
//
// A bot with Administrator still cannot assign a role positioned at or above
// its own highest role. Discord answers 403, and the natural reading of that
// is "the bot lacks Manage Roles" — which is wrong and sends you to the wrong
// settings page. `describeFailure` says so explicitly for exactly this reason.
// ---------------------------------------------------------------------------

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 8_000;

export interface DiscordRole {
  id: string;
  name: string;
  position: number;
  color?: number;
  /** True for roles Discord manages (bot roles, boosts). Never assignable. */
  managed?: boolean;
}

export type RoleResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number | null };

export function describeRoleFailure(status: number): string {
  switch (status) {
    case 401:
      return "Discord rejected the bot token (401). Check DISCORD_BOT_TOKEN.";
    case 403:
      return (
        "Discord refused the role change (403). The usual cause is ROLE HIERARCHY, not a missing " +
        "permission: a bot can only manage roles positioned BELOW its own highest role, and " +
        "Administrator does not override that. Move the bot's role above the assignable roles in " +
        "Server Settings -> Roles."
      );
    case 404:
      return "Not found (404). Check the guild, member and role ids.";
    case 429:
      return "Rate limited by Discord (429).";
    default:
      return `Discord returned HTTP ${status}.`;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    "User-Agent": "FurlPay-Roles (+https://furlpay.com)",
  };
}

/** Every role in the guild. */
export async function listRoles(token: string, guildId: string): Promise<RoleResult<DiscordRole[]>> {
  try {
    const res = await fetch(`${API}/guilds/${guildId}/roles`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describeRoleFailure(res.status), status: res.status };
    const data = (await res.json()) as DiscordRole[];
    if (!Array.isArray(data)) return { ok: false, error: "Discord returned an unexpected role list.", status: null };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not reach Discord.", status: null };
  }
}

/** Add one role to one member. Idempotent on Discord's side. */
export async function addRole(
  token: string,
  guildId: string,
  userId: string,
  roleId: string
): Promise<RoleResult<true>> {
  return roleWrite(token, "PUT", guildId, userId, roleId);
}

/** Remove one role from one member. Idempotent on Discord's side. */
export async function removeRole(
  token: string,
  guildId: string,
  userId: string,
  roleId: string
): Promise<RoleResult<true>> {
  return roleWrite(token, "DELETE", guildId, userId, roleId);
}

async function roleWrite(
  token: string,
  method: "PUT" | "DELETE",
  guildId: string,
  userId: string,
  roleId: string
): Promise<RoleResult<true>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${API}/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
        method,
        headers: { ...authHeaders(token), "Content-Length": "0" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { ok: false, error: "Could not reach Discord.", status: null };
    }

    if (res.ok || res.status === 204) return { ok: true, data: true };

    if (res.status === 429 && attempt === 0) {
      const retry = Number(res.headers.get("retry-after") ?? "1");
      const ms = Number.isFinite(retry) ? Math.max(retry, 0) * 1000 : 1000;
      await new Promise((r) => setTimeout(r, Math.min(ms, 5_000)));
      continue;
    }

    return { ok: false, error: describeRoleFailure(res.status), status: res.status };
  }
  return { ok: false, error: describeRoleFailure(429), status: 429 };
}

/**
 * Whether the bot can actually manage a given role.
 *
 * Two independent reasons it cannot, and both produce the same 403 at write
 * time, so they are worth distinguishing before the write:
 *
 *   - the role is `managed` (a bot's own role, or Server Booster). Nobody can
 *     assign these, including an owner.
 *   - the role sits at or above the bot's highest role.
 *
 * `botHighestPosition` is derived from the bot's own roles, not assumed.
 */
export function canManageRole(role: DiscordRole, botHighestPosition: number): { ok: boolean; reason?: string } {
  if (role.managed) {
    return { ok: false, reason: `"${role.name}" is managed by Discord and cannot be assigned by anyone.` };
  }
  if (role.position >= botHighestPosition) {
    return {
      ok: false,
      reason:
        `"${role.name}" is at position ${role.position} and the bot's highest role is at ` +
        `${botHighestPosition}. Discord requires the bot's role to be strictly higher.`,
    };
  }
  return { ok: true };
}

/** Create a role. Used by the setup endpoint for anything missing. */
export async function createRole(
  token: string,
  guildId: string,
  body: { name: string; color?: number; mentionable?: boolean }
): Promise<RoleResult<DiscordRole>> {
  try {
    const res = await fetch(`${API}/guilds/${guildId}/roles`, {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      // permissions "0": a self-assignable role grants membership of a group,
      // never a capability. Anything else would let the picker hand out powers.
      body: JSON.stringify({ ...body, permissions: "0" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describeRoleFailure(res.status), status: res.status };
    return { ok: true, data: (await res.json()) as DiscordRole };
  } catch {
    return { ok: false, error: "Could not reach Discord.", status: null };
  }
}

/**
 * Move a role to a new position.
 *
 * The fix for the hierarchy problem: the bot's own role has to sit above every
 * role it is expected to assign.
 */
export async function setRolePosition(
  token: string,
  guildId: string,
  roleId: string,
  position: number
): Promise<RoleResult<DiscordRole[]>> {
  try {
    const res = await fetch(`${API}/guilds/${guildId}/roles`, {
      method: "PATCH",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify([{ id: roleId, position }]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describeRoleFailure(res.status), status: res.status };
    return { ok: true, data: (await res.json()) as DiscordRole[] };
  } catch {
    return { ok: false, error: "Could not reach Discord.", status: null };
  }
}

/** Post a message, or edit one when `messageId` is given. */
export async function upsertMessage(
  token: string,
  channelId: string,
  payload: unknown,
  messageId?: string | null
): Promise<RoleResult<{ id?: string }>> {
  const url = messageId
    ? `${API}/channels/${channelId}/messages/${messageId}`
    : `${API}/channels/${channelId}/messages`;
  try {
    const res = await fetch(url, {
      method: messageId ? "PATCH" : "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describeRoleFailure(res.status), status: res.status };
    return { ok: true, data: (await res.json()) as { id?: string } };
  } catch {
    return { ok: false, error: "Could not reach Discord.", status: null };
  }
}

/** This bot's own user id, cached for the life of the process. */
let selfId: string | null = null;
export async function botUserId(token: string): Promise<string | null> {
  if (selfId) return selfId;
  try {
    const res = await fetch(`${API}/users/@me`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    selfId = ((await res.json()) as { id?: string }).id ?? null;
    return selfId;
  } catch {
    return null;
  }
}

/** The bot's highest role position, from its member record. */
export async function botHighestRolePosition(
  token: string,
  guildId: string,
  botUserId: string
): Promise<RoleResult<number>> {
  const roles = await listRoles(token, guildId);
  if (!roles.ok) return roles;

  let member: { roles?: string[] };
  try {
    const res = await fetch(`${API}/guilds/${guildId}/members/${botUserId}`, {
      headers: authHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: describeRoleFailure(res.status), status: res.status };
    member = (await res.json()) as { roles?: string[] };
  } catch {
    return { ok: false, error: "Could not reach Discord.", status: null };
  }

  const owned = new Set(member.roles ?? []);
  let highest = 0;
  for (const r of roles.data) {
    if (owned.has(r.id) && r.position > highest) highest = r.position;
  }
  return { ok: true, data: highest };
}
