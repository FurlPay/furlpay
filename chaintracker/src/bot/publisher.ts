// Publishing to Discord over the REST API.
//
// Deliberately REST-only, no gateway connection. That matters for this
// deployment: the target application has an interactions endpoint URL set, so
// a gateway bot would receive nothing — but posting has never depended on the
// gateway, and this path works with the credentials as they stand today.
//
// Idempotence is the other design goal. The daily post EDITS the previous
// day's message when it is still the newest in the channel, so the channel
// reads as a live dashboard rather than an ever-growing wall of duplicates.

import { REST } from "@discordjs/rest";
import {
  Routes,
  ChannelType,
  type APIChannel,
  type APIMessage,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";

/** Only the fields we read off a guild channel listing. */
interface GuildChannelLite {
  id: string;
  name?: string | null;
  type: ChannelType;
  parent_id?: string | null;
}
import type { EmbedBuilder } from "discord.js";
import { env } from "../config/env.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("publish");

export interface PublishTarget {
  guildId: string;
  channelName: string;
  categoryName?: string;
  topic?: string;
}

export class Publisher {
  private rest: REST;

  constructor(token: string) {
    this.rest = new REST({ version: "10" }).setToken(token);
  }

  static fromEnv(): Publisher {
    if (!env.discordToken) throw new Error("DISCORD_BOT_TOKEN is not set");
    return new Publisher(env.discordToken);
  }

  async guildChannels(guildId: string): Promise<GuildChannelLite[]> {
    return (await this.rest.get(Routes.guildChannels(guildId))) as GuildChannelLite[];
  }

  /** Find a channel by name, case-insensitively, ignoring emoji prefixes. */
  async findChannel(guildId: string, name: string): Promise<GuildChannelLite | null> {
    const wanted = normalise(name);
    const all = await this.guildChannels(guildId);
    return (
      all.find((c) => c.type === ChannelType.GuildText && normalise(c.name ?? "") === wanted) ?? null
    );
  }

  /** Find a category (channel type 4) by name. */
  async findCategory(guildId: string, name: string): Promise<GuildChannelLite | null> {
    const wanted = normalise(name);
    const all = await this.guildChannels(guildId);
    return (
      all.find((c) => c.type === ChannelType.GuildCategory && normalise(c.name ?? "") === wanted) ??
      null
    );
  }

  /**
   * Get or create a text channel. Returns the existing one untouched when it
   * is already there — creating a duplicate in a live community server would
   * be worse than doing nothing.
   */
  async ensureChannel(t: PublishTarget): Promise<{ id: string; created: boolean; name: string }> {
    const existing = await this.findChannel(t.guildId, t.channelName);
    if (existing) {
      log.info("channel already exists", { name: existing.name, id: existing.id });
      return { id: existing.id, created: false, name: existing.name ?? t.channelName };
    }

    let parentId: string | undefined;
    if (t.categoryName) {
      const cat = await this.findCategory(t.guildId, t.categoryName);
      if (cat) {
        parentId = cat.id;
      } else {
        const made = (await this.rest.post(Routes.guildChannels(t.guildId), {
          body: { name: t.categoryName, type: ChannelType.GuildCategory },
        })) as APIChannel;
        parentId = made.id;
        log.info("category created", { name: t.categoryName, id: made.id });
      }
    }

    const body: Record<string, unknown> = {
      name: t.channelName,
      type: ChannelType.GuildText,
    };
    if (t.topic) body.topic = t.topic.slice(0, 1024);
    if (parentId) body.parent_id = parentId;

    const created = (await this.rest.post(Routes.guildChannels(t.guildId), { body })) as APIChannel;
    log.info("channel created", { name: t.channelName, id: created.id });
    return { id: created.id, created: true, name: t.channelName };
  }

  async send(channelId: string, embeds: EmbedBuilder[], content?: string): Promise<APIMessage> {
    const body: RESTPostAPIChannelMessageJSONBody = {
      embeds: embeds.slice(0, 10).map((e) => e.toJSON()),
    };
    if (content) body.content = content.slice(0, 2000);
    return (await this.rest.post(Routes.channelMessages(channelId), { body })) as APIMessage;
  }

  async edit(channelId: string, messageId: string, embeds: EmbedBuilder[], content?: string): Promise<APIMessage> {
    const body: RESTPostAPIChannelMessageJSONBody = {
      embeds: embeds.slice(0, 10).map((e) => e.toJSON()),
    };
    if (content !== undefined) body.content = content.slice(0, 2000);
    return (await this.rest.patch(Routes.channelMessage(channelId, messageId), {
      body,
    })) as APIMessage;
  }

  async recentMessages(channelId: string, limit = 10): Promise<APIMessage[]> {
    return (await this.rest.get(Routes.channelMessages(channelId), {
      query: new URLSearchParams({ limit: String(limit) }),
    })) as APIMessage[];
  }

  /**
   * Post, or edit our own most recent message when it carries `marker`.
   * The marker lives in the embed footer, which users see anyway, so this
   * needs no hidden state and survives a database reset.
   */
  async upsertByMarker(
    channelId: string,
    marker: string,
    embeds: EmbedBuilder[],
    content?: string,
  ): Promise<{ messageId: string; edited: boolean }> {
    const botId = await this.selfId();
    const recent = await this.recentMessages(channelId, 15).catch(() => [] as APIMessage[]);
    const mine = recent.find(
      (m) =>
        m.author?.id === botId &&
        (m.embeds ?? []).some((e) => (e.footer?.text ?? "").includes(marker)),
    );
    if (mine) {
      await this.edit(channelId, mine.id, embeds, content);
      return { messageId: mine.id, edited: true };
    }
    const sent = await this.send(channelId, embeds, content);
    return { messageId: sent.id, edited: false };
  }

  async pin(channelId: string, messageId: string): Promise<void> {
    try {
      await this.rest.put(Routes.channelPin(channelId, messageId));
    } catch (err) {
      log.warn("pin failed", { err: (err as Error).message.slice(0, 120) });
    }
  }

  private cachedSelf: string | null = null;
  async selfId(): Promise<string> {
    if (this.cachedSelf) return this.cachedSelf;
    const app = (await this.rest.get(Routes.oauth2CurrentApplication())) as { id: string };
    this.cachedSelf = app.id;
    return app.id;
  }

  async appInfo(): Promise<{ id: string; name: string; interactionsUrl: string | null }> {
    const app = (await this.rest.get(Routes.oauth2CurrentApplication())) as {
      id: string;
      name: string;
      interactions_endpoint_url?: string | null;
    };
    return {
      id: app.id,
      name: app.name,
      interactionsUrl: app.interactions_endpoint_url ?? null,
    };
  }
}

/** Emoji prefixes and spacing are stripped, so a channel named
 *  "x-whale-alerts" and one named "whale alerts" both match "whale-alerts". */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export { normalise };
