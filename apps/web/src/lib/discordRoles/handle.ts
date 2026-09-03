// ---------------------------------------------------------------------------
// Handling a role-picker submission.
//
// ── THE DIFF IS THE WHOLE BEHAVIOUR ────────────────────────────────────────
//
// A select menu submits the member's COMPLETE choice for that menu, not a
// delta. So the handler compares the submitted set against what the member
// currently holds FROM THAT MENU'S OPTIONS ONLY, and applies the difference.
//
// Scoping the comparison to the menu's own options is the part that has to be
// right. Diffing against every role the member has would mean submitting the
// identity menu strips their notification roles — and, far worse, would compute
// "remove Moderator" for anyone holding it, because Moderator is not among the
// submitted values. The picker must never be able to remove a role it could
// not grant.
//
// ── SUBMITTED VALUES ARE UNTRUSTED ─────────────────────────────────────────
//
// Discord's signature proves the interaction came from Discord. It does not
// prove the payload only contains options the menu offered. Every value is
// therefore resolved through the catalog, which refuses anything that is not
// explicitly self-assignable — so a forged value of "moderator" resolves to
// null and is dropped rather than granted.
// ---------------------------------------------------------------------------

import { kvGet, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";
import { resolveSelfAssignableKey, selfAssignable, type RoleSpec } from "./catalog";
import { groupForCustomId } from "./picker";
import {
  addRole,
  botHighestRolePosition,
  botUserId,
  canManageRole,
  listRoles,
  removeRole,
  type DiscordRole,
} from "./rest";

/** Role lists change rarely; a short cache keeps a click from costing two
 *  round-trips, and a stale entry self-corrects within the minute. */
const ROLE_CACHE_TTL = 60;

export interface ComponentInteraction {
  data?: { custom_id?: string; values?: string[] };
  guild_id?: string;
  member?: { user?: { id?: string }; roles?: string[] };
}

export interface RoleChangeResult {
  /** Ephemeral message payload to reply with. */
  reply: Record<string, unknown>;
  added: string[];
  removed: string[];
  failed: string[];
}

const EPHEMERAL = 1 << 6;

function ephemeral(content: string): Record<string, unknown> {
  return { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } };
}

/** Guild roles, cached briefly. */
async function guildRoles(token: string, guildId: string): Promise<DiscordRole[] | null> {
  const key = `discord:roles:${guildId}`;
  const cached = await kvGet<DiscordRole[]>(key).catch(() => null);
  if (cached) return cached;

  const fresh = await listRoles(token, guildId);
  if (!fresh.ok) return null;
  await kvSet(key, fresh.data, ROLE_CACHE_TTL).catch(() => {});
  return fresh.data;
}

/**
 * Apply a picker submission.
 *
 * Returns a reply payload in every case, including every failure — an
 * interaction that gets no response shows the member a red "interaction
 * failed", which tells them nothing about what to do next.
 */
export async function handleRolePicker(
  interaction: ComponentInteraction,
  token: string
): Promise<RoleChangeResult | null> {
  const customId = interaction.data?.custom_id ?? "";
  const group = groupForCustomId(customId);
  if (!group) return null; // Not a role picker; let the caller handle it.

  const guildId = interaction.guild_id;
  const userId = interaction.member?.user?.id;
  if (!guildId || !userId) {
    return {
      reply: ephemeral("Role picking only works inside the FurlPay server."),
      added: [],
      removed: [],
      failed: [],
    };
  }

  // The menu's own option set. Everything below is scoped to this.
  const groupSpecs = selfAssignable(group);

  // Untrusted input, resolved through the catalog. Anything unknown or not
  // self-assignable disappears here rather than reaching the Discord API.
  const submitted: RoleSpec[] = [];
  for (const value of interaction.data?.values ?? []) {
    const spec = resolveSelfAssignableKey(value);
    // Also require the value to belong to THIS menu, so a value from the
    // notify menu cannot be replayed into the identity menu's diff.
    if (spec && spec.group === group) submitted.push(spec);
  }

  const roles = await guildRoles(token, guildId);
  if (!roles) {
    return {
      reply: ephemeral("Could not read the server's roles just now. Try again in a moment."),
      added: [],
      removed: [],
      failed: [],
    };
  }

  const byName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));
  const roleFor = (s: RoleSpec) => byName.get(s.name.toLowerCase()) ?? null;

  const held = new Set(interaction.member?.roles ?? []);

  // Only roles this menu offers are eligible for removal — see the header.
  const inGroup = groupSpecs.map((s) => ({ spec: s, role: roleFor(s) })).filter((x) => x.role !== null) as {
    spec: RoleSpec;
    role: DiscordRole;
  }[];

  const desiredIds = new Set(
    submitted.map((s) => roleFor(s)?.id).filter((id): id is string => typeof id === "string")
  );

  const toAdd = inGroup.filter((x) => desiredIds.has(x.role.id) && !held.has(x.role.id));
  const toRemove = inGroup.filter((x) => !desiredIds.has(x.role.id) && held.has(x.role.id));

  if (toAdd.length === 0 && toRemove.length === 0) {
    return { reply: ephemeral("No changes — you already have exactly those roles."), added: [], removed: [], failed: [] };
  }

  // Check hierarchy ONCE before writing, so a misconfigured server produces one
  // clear explanation instead of N identical 403s. A failure to determine the
  // bot's own position is not fatal — the writes below still report honestly.
  const self = await botUserId(token);
  const botPos = self
    ? await botHighestRolePosition(token, guildId, self)
    : ({ ok: false, error: "unknown bot id", status: null } as const);
  if (botPos.ok) {
    const blocked = [...toAdd, ...toRemove]
      .map((x) => ({ x, check: canManageRole(x.role, botPos.data) }))
      .filter((r) => !r.check.ok);
    if (blocked.length > 0) {
      log.warn("role picker blocked by hierarchy", {
        guildId,
        blocked: blocked.map((b) => b.x.role.name).join(","),
      });
      return {
        reply: ephemeral(
          "I can't change those roles yet — my own role needs to sit above them in Server Settings → Roles. " +
            "A server admin can fix this by dragging the FurlPay role to the top of the list."
        ),
        added: [],
        removed: [],
        failed: blocked.map((b) => b.x.spec.name),
      };
    }
  }

  const added: string[] = [];
  const removed: string[] = [];
  const failed: string[] = [];

  for (const x of toAdd) {
    const r = await addRole(token, guildId, userId, x.role.id);
    if (r.ok) added.push(x.spec.name);
    else failed.push(x.spec.name);
  }
  for (const x of toRemove) {
    const r = await removeRole(token, guildId, userId, x.role.id);
    if (r.ok) removed.push(x.spec.name);
    else failed.push(x.spec.name);
  }

  log.info("role picker applied", { guildId, userId, group, added: added.length, removed: removed.length, failed: failed.length });

  const lines: string[] = [];
  if (added.length) lines.push(`Added: ${added.join(", ")}`);
  if (removed.length) lines.push(`Removed: ${removed.join(", ")}`);
  if (failed.length) lines.push(`Could not change: ${failed.join(", ")}`);

  return {
    reply: ephemeral(lines.join("\n") || "Nothing changed."),
    added,
    removed,
    failed,
  };
}
