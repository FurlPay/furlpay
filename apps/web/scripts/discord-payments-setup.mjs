#!/usr/bin/env node
/**
 * Register the /payments command and publish the Payments Center message.
 *
 * Usage:
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... node scripts/discord-payments-setup.mjs [--apply]
 *
 * Runs as a DRY RUN by default. `--apply` is required to write anything to
 * Discord, because this script creates a channel and posts a pinned message
 * into a live server, and neither is convenient to undo by hand.
 *
 * THE TOKEN COMES FROM THE ENVIRONMENT. Never paste it into a file, a commit,
 * or a chat window — a bot token is a bearer credential with whatever
 * permissions the bot holds, and anyone who reads it can act as the bot until
 * it is reset. If one has been exposed, reset it in the Developer Portal
 * before running this.
 */

const APPLY = process.argv.includes("--apply");
const TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
const GUILD = process.env.DISCORD_GUILD_ID?.trim();
const CHANNEL_NAME = process.env.FURLPAY_PAYMENTS_CHANNEL?.trim() || "payments-payouts";

const API = "https://discord.com/api/v10";

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!TOKEN) {
  die(
    "DISCORD_BOT_TOKEN is not set.\n" +
      "  Set it in the environment (or apps/web/.env.local, which is gitignored).\n" +
      "  Never commit it and never paste it into a message."
  );
}
if (!GUILD) die("DISCORD_GUILD_ID is not set.");
if (!/^\d{17,20}$/.test(GUILD)) die(`DISCORD_GUILD_ID "${GUILD}" is not a Discord snowflake.`);

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${TOKEN}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    // Discord's error bodies are informative and contain no secrets, so they
    // are surfaced rather than swallowed behind a generic failure.
    throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${JSON.stringify(body)}`);
  }
  return body;
}

// ── the command ────────────────────────────────────────────────────────────

const COMMAND = {
  name: "payments",
  description: "Open your private FurlPay payments console",
  // Guild-scoped: it appears immediately, and it is not published to servers
  // that have no FurlPay payment accounts.
  type: 1,
};

// ── the pinned message ─────────────────────────────────────────────────────
//
// Deliberately carries NO balances. The public message is an entry point; the
// numbers live behind the button, in an ephemeral reply only the reader sees.

const PINNED = {
  embeds: [
    {
      title: "FurlPay Payments Center",
      description: [
        "Manage your earnings, payout wallet and payment history from here.",
        "",
        "Everything you open is private to you — balances and wallet addresses are never posted into this channel.",
      ].join("\n"),
      color: 0x5865f2,
      fields: [
        {
          name: "Getting paid",
          value: "Onboard, add a payout wallet, complete work, request a payout.",
          inline: false,
        },
        {
          name: "Supported",
          value: "USDC on Base, Arbitrum, Polygon and Solana. BTC on-chain.",
          inline: false,
        },
        {
          name: "Security",
          value:
            "FurlPay will never ask for your seed phrase, private key, recovery phrase or wallet password.",
          inline: false,
        },
      ],
      footer: { text: "FurlPay Payments" },
    },
  ],
  components: [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Open payments console", custom_id: "fp:pay:home" },
        { type: 2, style: 2, label: "Add payout wallet", custom_id: "fp:pay:wallet_asset" },
        { type: 2, style: 2, label: "Security", custom_id: "fp:pay:security" },
      ],
    },
  ],
};

// ── run ────────────────────────────────────────────────────────────────────

async function main() {
  const me = await api("/users/@me");
  console.log(`\n  Bot        ${me.username} (${me.id})`);
  console.log(`  Guild      ${GUILD}`);
  console.log(`  Channel    #${CHANNEL_NAME}`);
  console.log(`  Mode       ${APPLY ? "APPLY — will write to Discord" : "DRY RUN — nothing will change"}\n`);

  const guild = await api(`/guilds/${GUILD}`);
  console.log(`  Connected to "${guild.name}".`);

  const channels = await api(`/guilds/${GUILD}/channels`);
  let channel = channels.find((c) => c.name === CHANNEL_NAME && c.type === 0);

  if (channel) {
    console.log(`  Found #${CHANNEL_NAME} (${channel.id}).`);
  } else if (!APPLY) {
    console.log(`  Would CREATE #${CHANNEL_NAME}.`);
  } else {
    channel = await api(`/guilds/${GUILD}/channels`, {
      method: "POST",
      body: JSON.stringify({
        name: CHANNEL_NAME,
        type: 0,
        topic: "FurlPay payments and payouts. Everything you open here is private to you.",
      }),
    });
    console.log(`  Created #${CHANNEL_NAME} (${channel.id}).`);
  }

  if (!APPLY) {
    console.log(`  Would REGISTER /payments in guild ${GUILD}.`);
    console.log(`  Would POST and PIN the Payments Center message.`);
    console.log(`\n  Dry run complete. Re-run with --apply to make these changes.\n`);
    return;
  }

  await api(`/applications/${me.id}/guilds/${GUILD}/commands`, {
    method: "POST",
    body: JSON.stringify(COMMAND),
  });
  console.log("  Registered /payments.");

  const message = await api(`/channels/${channel.id}/messages`, {
    method: "POST",
    body: JSON.stringify(PINNED),
  });
  console.log(`  Posted the Payments Center message (${message.id}).`);

  try {
    await api(`/channels/${channel.id}/messages/pins/${message.id}`, { method: "PUT" });
    console.log("  Pinned it.");
  } catch (e) {
    // Pinning needs MANAGE_MESSAGES. Worth reporting, not worth failing the
    // whole setup for — the message is already posted and functional.
    console.log(`  Could not pin (needs Manage Messages): ${e.message}`);
  }

  console.log(
    `\n  Done. Set the interactions endpoint to:\n` +
      `    https://furlpay.com/api/discord/interactions\n` +
      `  in Developer Portal -> General Information -> Interactions Endpoint URL.\n`
  );
}

main().catch((e) => {
  console.error(`\n  Failed: ${e.message}\n`);
  process.exit(1);
});
