import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { requireCron } from "@/lib/cron/auth";
import { kvGet, kvSet } from "@/lib/kv";
import { log } from "@/lib/log";
import { ROLE_CATALOG, allSelfAssignable } from "@/lib/discordRoles/catalog";
import { buildRolePicker } from "@/lib/discordRoles/picker";
import {
  botHighestRolePosition,
  botUserId,
  canManageRole,
  createRole,
  listRoles,
  setRolePosition,
  upsertMessage,
  type DiscordRole,
} from "@/lib/discordRoles/rest";
import { isSnowflake } from "@/lib/discordWelcome/config";
import { buildVerifyPanel } from "@/lib/discordVerify/flow";
import { ensureVoiceChannels } from "@/lib/discordServer/voice";
import { ensureRoleEmoji } from "@/lib/discordServer/emoji";
import {
  MOD_UPDATES_CHANNEL_NAME,
  RULES_CHANNEL_NAME,
  buildRulesMessage,
  configureOnboarding,
  defaultChannels,
  enableCommunity,
  ensureTextChannel,
} from "@/lib/discordServer/community";
import { listChannels } from "@/lib/discordServer/voice";

// ---------------------------------------------------------------------------
// GET /api/discord/roles-setup — reconcile the server's roles with the catalog.
//
// AN OPERATOR ENDPOINT, NOT A CRON. It is authenticated with the same cron
// secret because that is the existing machinery for "a request no member of the
// public may make", but it is deliberately absent from vercel.json: creating
// roles and posting a picker is something a person decides to do, not something
// that should happen at 3am on a schedule.
//
// READ-ONLY BY DEFAULT. A bare GET reports what it WOULD do: which catalog
// roles are missing, whether the bot can actually assign them, and whether the
// picker has been posted. `?apply=1` is what changes anything. Getting this the
// wrong way round means a stray request reorganises a live community.
//
// IDEMPOTENT. Roles are matched by name and only created when missing; the
// picker message id is remembered so a second apply EDITS the existing message
// rather than posting a second picker.
// ---------------------------------------------------------------------------

/** Remembered so re-applying edits the picker instead of duplicating it. */
const pickerKey = (channelId: string) => `discord:rolepicker:${channelId}`;
/** Same idea for the verification panel. */
const panelKey = (channelId: string) => `discord:verifypanel:${channelId}`;
/** And for the rules post. */
const rulesKey = (channelId: string) => `discord:rules:${channelId}`;

/** Long-lived: the picker is a permanent fixture of the server. */
const PICKER_TTL_SECONDS = 60 * 60 * 24 * 365;

export async function GET(req: NextRequest) {
  const auth = requireCron(req);
  if (!auth.ok) return auth.res;

  const apply = req.nextUrl.searchParams.get("apply") === "1";

  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  const channelId = process.env.ROLE_PICKER_CHANNEL_ID?.trim();

  if (!token) return NextResponse.json({ ok: false, reason: "DISCORD_BOT_TOKEN is not set" }, { status: 200 });
  if (!isSnowflake(guildId)) {
    return NextResponse.json({ ok: false, reason: "DISCORD_GUILD_ID is not set or not a Discord id" }, { status: 200 });
  }

  const existing = await listRoles(token, guildId);
  if (!existing.ok) return NextResponse.json({ ok: false, reason: existing.error }, { status: 200 });

  const byName = new Map(existing.data.map((r) => [r.name.toLowerCase(), r]));

  // ---- 1. Which catalog roles are missing ------------------------------
  const missing = ROLE_CATALOG.filter((s) => !byName.has(s.name.toLowerCase()));
  const created: string[] = [];
  const createFailed: { name: string; error: string }[] = [];

  if (apply) {
    for (const spec of missing) {
      const r = await createRole(token, guildId, {
        name: spec.name,
        color: spec.color,
        mentionable: spec.group === "notify",
      });
      if (r.ok) {
        created.push(spec.name);
        byName.set(spec.name.toLowerCase(), r.data);
      } else {
        createFailed.push({ name: spec.name, error: r.error });
      }
    }
  }

  // ---- 2. Can the bot actually assign them? ----------------------------
  //
  // The check that matters most on a fresh server, where every role tends to
  // sit at position 1 alongside the bot's own and NOTHING is assignable.
  const self = await botUserId(token);
  const botPos = self ? await botHighestRolePosition(token, guildId, self) : null;

  const fresh = await listRoles(token, guildId);
  const roles: DiscordRole[] = fresh.ok ? fresh.data : existing.data;
  const nowByName = new Map(roles.map((r) => [r.name.toLowerCase(), r]));

  const blocked: string[] = [];
  if (botPos?.ok) {
    for (const spec of allSelfAssignable()) {
      const role = nowByName.get(spec.name.toLowerCase());
      if (role && !canManageRole(role, botPos.data).ok) blocked.push(spec.name);
    }
  }

  // ---- 3. Fix the hierarchy if asked ----------------------------------
  let hierarchyFix: Record<string, unknown> | null = null;
  if (apply && blocked.length > 0 && self) {
    const botRole = roles.find((r) => r.managed && r.name.toLowerCase() === "furlpay");
    if (!botRole) {
      hierarchyFix = { ok: false, reason: "Could not find the bot's own managed role to raise." };
    } else {
      // One above the highest non-managed role, so the bot outranks everything
      // it must assign without being pushed above roles it has no business
      // outranking any more than necessary.
      const target = Math.max(...roles.filter((r) => !r.managed).map((r) => r.position), 0) + 1;
      const moved = await setRolePosition(token, guildId, botRole.id, target);
      hierarchyFix = moved.ok
        ? { ok: true, movedTo: target, note: "Bot role raised above the assignable roles." }
        : { ok: false, reason: moved.error };
      if (moved.ok) blocked.length = 0;
    }
  }

  // ---- 3b. Upload the role icons as custom guild emoji -----------------
  //
  // Before the picker, because the picker embeds their ids. A failure here is
  // NOT fatal: the picker falls back to the catalog's unicode emoji, which is
  // worse-looking but fully functional.
  const iconOrigin = (process.env.FURLPAY_ORIGIN?.trim() || "https://furlpay.com").replace(/\/$/, "");
  const iconKeys = allSelfAssignable().map((r) => r.key);
  const emoji = await ensureRoleEmoji(token, guildId, iconKeys, iconOrigin, apply);
  const icons = emoji.ok ? emoji.data.resolved : {};

  // ---- 4. Post or update the picker -----------------------------------
  let picker: Record<string, unknown> | null = null;
  if (!isSnowflake(channelId)) {
    picker = { ok: false, reason: "ROLE_PICKER_CHANNEL_ID is not set or not a Discord id" };
  } else if (apply) {
    const known = await kvGet<string>(pickerKey(channelId)).catch(() => null);
    let res = await upsertMessage(token, channelId, buildRolePicker(new Set(), icons), known);
    // A remembered id that no longer exists must not stop the picker existing.
    if (!res.ok && known) res = await upsertMessage(token, channelId, buildRolePicker(new Set(), icons), null);
    if (res.ok && res.data.id) {
      await kvSet(pickerKey(channelId), res.data.id, PICKER_TTL_SECONDS).catch(() => {});
      picker = { ok: true, messageId: res.data.id, action: known ? "edited" : "posted" };
    } else {
      picker = { ok: false, reason: res.ok ? "Discord returned no message id" : res.error };
    }
  } else {
    picker = { ok: true, wouldPostTo: channelId, note: "add ?apply=1 to post it" };
  }

  // ---- 5. The verification panel --------------------------------------
  const verifyChannelId = process.env.VERIFY_CHANNEL_ID?.trim();
  let verifyPanel: Record<string, unknown> | null = null;
  if (!isSnowflake(verifyChannelId)) {
    verifyPanel = { ok: false, reason: "VERIFY_CHANNEL_ID is not set or not a Discord id" };
  } else if (apply) {
    const known = await kvGet<string>(panelKey(verifyChannelId)).catch(() => null);
    let res = await upsertMessage(token, verifyChannelId, buildVerifyPanel(), known);
    if (!res.ok && known) res = await upsertMessage(token, verifyChannelId, buildVerifyPanel(), null);
    if (res.ok && res.data.id) {
      await kvSet(panelKey(verifyChannelId), res.data.id, PICKER_TTL_SECONDS).catch(() => {});
      verifyPanel = { ok: true, messageId: res.data.id, action: known ? "edited" : "posted" };
    } else {
      verifyPanel = { ok: false, reason: res.ok ? "Discord returned no message id" : res.error };
    }
  } else {
    verifyPanel = { ok: true, wouldPostTo: verifyChannelId, note: "add ?apply=1 to post it" };
  }

  // ---- 6. Voice channels ----------------------------------------------
  const voice = await ensureVoiceChannels(token, guildId, apply);

  // ---- 7. Community mode, rules and native onboarding ------------------
  //
  // Community mode is the precondition for BOTH the rules screen and
  // onboarding, so it goes first and everything after it reports honestly if
  // it could not be turned on.
  const rulesCh = await ensureTextChannel(
    token, guildId, RULES_CHANNEL_NAME, "The rules of the FurlPay community. Read before posting.", apply
  );
  const modCh = await ensureTextChannel(
    token, guildId, MOD_UPDATES_CHANNEL_NAME, "Discord's notices to server moderators.", apply
  );

  let community: Record<string, unknown> = { ok: false, reason: "not attempted" };
  let onboarding: Record<string, unknown> = { ok: false, reason: "not attempted" };
  let rulesPost: Record<string, unknown> = { ok: false, reason: "not attempted" };

  const guildRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${token}` },
    cache: "no-store",
  });
  const guildJson = guildRes.ok ? ((await guildRes.json()) as { features?: string[] }) : null;
  const features = guildJson?.features ?? [];

  if (!apply) {
    community = {
      ok: true,
      alreadyCommunity: features.includes("COMMUNITY"),
      note: "add ?apply=1 to enable Community, post the rules and configure onboarding",
    };
    onboarding = { ok: true, note: "add ?apply=1" };
    rulesPost = { ok: true, note: "add ?apply=1" };
  } else if (!rulesCh.ok || !modCh.ok || !rulesCh.data.channel || !modCh.data.channel) {
    community = { ok: false, reason: "Could not create the rules / mod-updates channels." };
  } else {
    // The rules text, as a channel message. This is NOT the membership-screening
    // screen — see community.ts — but it is the canonical copy that screen's
    // text should be pasted from.
    const known = await kvGet<string>(rulesKey(rulesCh.data.channel.id)).catch(() => null);
    let posted = await upsertMessage(token, rulesCh.data.channel.id, buildRulesMessage(), known);
    if (!posted.ok && known) posted = await upsertMessage(token, rulesCh.data.channel.id, buildRulesMessage(), null);
    if (posted.ok && posted.data.id) {
      await kvSet(rulesKey(rulesCh.data.channel.id), posted.data.id, PICKER_TTL_SECONDS).catch(() => {});
      rulesPost = { ok: true, messageId: posted.data.id, channel: RULES_CHANNEL_NAME };
    } else {
      rulesPost = { ok: false, reason: posted.ok ? "no message id" : posted.error };
    }

    const enabled = await enableCommunity(token, guildId, {
      rulesChannelId: rulesCh.data.channel.id,
      modUpdatesChannelId: modCh.data.channel.id,
      existingFeatures: features,
    });
    community = enabled.ok
      ? { ok: true, community: enabled.data.features.includes("COMMUNITY") }
      : { ok: false, reason: enabled.error };

    // Onboarding needs Community; attempting it before is a guaranteed 400.
    if (enabled.ok && enabled.data.features.includes("COMMUNITY")) {
      const all = await listChannels(token, guildId);
      const defaults = all.ok ? defaultChannels(all.data) : [];
      const roleId = (name: string) => nowByName.get(name.toLowerCase())?.id;

      const prompts = [
        {
          title: "What do you do?",
          singleSelect: false,
          options: allSelfAssignable()
            .filter((r) => r.group === "identity")
            .map((r) => ({
              title: r.name,
              description: r.description,
              roleIds: [roleId(r.name)].filter((x): x is string => Boolean(x)),
              emojiId: icons[r.key]?.id,
              emojiName: icons[r.key]?.name ?? r.emoji,
            })),
        },
        {
          title: "What should we ping you for?",
          singleSelect: false,
          options: allSelfAssignable()
            .filter((r) => r.group === "notify")
            .map((r) => ({
              title: r.name,
              description: r.description,
              roleIds: [roleId(r.name)].filter((x): x is string => Boolean(x)),
              emojiId: icons[r.key]?.id,
              emojiName: icons[r.key]?.name ?? r.emoji,
            })),
        },
      ];

      if (defaults.length < 7) {
        onboarding = {
          ok: false,
          reason: `Discord needs at least 7 default channels; only ${defaults.length} matched.`,
          defaultChannels: defaults.length,
        };
      } else {
        const res = await configureOnboarding(token, guildId, prompts, defaults);
        onboarding = res.ok
          ? { ok: true, enabled: res.data.enabled, prompts: prompts.length, defaultChannels: defaults.length }
          : { ok: false, reason: res.error, defaultChannels: defaults.length };
      }
    } else {
      onboarding = { ok: false, reason: "Community mode is not enabled, which onboarding requires." };
    }
  }

  if (apply) {
    log.info("discord server setup applied", {
      guildId,
      created: created.length,
      blocked: blocked.length,
    });
  }

  return NextResponse.json({
    ok: true,
    applied: apply,
    guildId,
    botHighestRolePosition: botPos?.ok ? botPos.data : null,
    catalogSize: ROLE_CATALOG.length,
    selfAssignable: allSelfAssignable().length,
    missing: missing.map((m) => m.name),
    created,
    createFailed,
    // Non-empty here means the picker will refuse every click until the bot's
    // role is raised — the single most likely reason "roles don't work".
    blockedByHierarchy: blocked,
    hierarchyFix,
    picker,
    verifyPanel,
    emoji: emoji.ok ? emoji.data : { error: emoji.error },
    voice: voice.ok ? voice.data : { error: voice.error },
    rules: rulesPost,
    community,
    onboarding,
  });
}
