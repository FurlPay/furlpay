// Furlpay Discord server as code — creates the full community structure
// (roles, categories, channels, topics, read-only permissions, welcome posts)
// via the Discord REST API. Idempotent: safe to re-run; existing roles and
// channels are matched by name and left in place, topics are updated.
//
// Usage:
//   DISCORD_TOKEN=<bot token> DISCORD_GUILD_ID=<server id> node scripts/deploy-discord-server.mjs
//
// The bot must be in the server with Administrator (or Manage Roles +
// Manage Channels). Get the guild id via User Settings → Advanced →
// Developer Mode → right-click server → Copy Server ID.
//
// Note: Announcement (type 5), Forum (15) and Stage (13) channels require
// the guild to have Community enabled (Server Settings → Enable Community).
// Without it, this script falls back to plain text/voice channels.

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
if (!TOKEN || !GUILD) {
  console.error("Set DISCORD_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const API = "https://discord.com/api/v10";
const HEADERS = { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" };

// Channel types
const TEXT = 0, VOICE = 2, CATEGORY = 4, ANNOUNCEMENT = 5, STAGE = 13, FORUM = 15;
// @everyone permission overwrite that makes a channel read-only
const SEND_MESSAGES = "2048";
const readOnly = (guildId) => [
  { id: guildId, type: 0, deny: SEND_MESSAGES, allow: "0" },
];

const ROLES = [
  { name: "Founder", color: 0x00e599, hoist: true },
  { name: "Team", color: 0x00b377, hoist: true },
  { name: "Moderator", color: 0x3ba55d, hoist: true },
  { name: "Developer", color: 0x5865f2, hoist: false },
  { name: "Builder", color: 0x9b59b6, hoist: false },
  { name: "Merchant", color: 0xe67e22, hoist: false },
  { name: "Traveler", color: 0x1abc9c, hoist: false },
  { name: "Investor", color: 0xf1c40f, hoist: false },
  { name: "Partner", color: 0xe91e63, hoist: false },
  { name: "Early Supporter", color: 0x95a5a6, hoist: false },
  { name: "Beta Tester", color: 0x11806a, hoist: false },
  { name: "Contributor", color: 0x2ecc71, hoist: false },
];

const STRUCTURE = [
  {
    category: "INFORMATION",
    channels: [
      { name: "welcome", type: TEXT, topic: "Start here — what Furlpay is and how this server works.", readOnly: true },
      { name: "announcements", type: ANNOUNCEMENT, topic: "Product launches and major updates from the Furlpay team.", readOnly: true },
      { name: "changelog", type: ANNOUNCEMENT, topic: "Releases and deployments, synced from GitHub.", readOnly: true },
      { name: "roadmap", type: TEXT, topic: "What we are building next. Discussion welcome in #feedback.", readOnly: true },
      { name: "faq", type: TEXT, topic: "Frequently asked questions about Furlpay.", readOnly: true },
    ],
  },
  {
    category: "COMMUNITY",
    channels: [
      { name: "general", type: TEXT, topic: "Talk about anything Furlpay, payments, travel or investing." },
      { name: "introductions", type: TEXT, topic: "Say hi — who you are and what you are building." },
      { name: "showcase", type: TEXT, topic: "Show what you built with Furlpay APIs and SDKs." },
      { name: "feedback", type: TEXT, topic: "Product feedback and ideas. We read everything." },
      { name: "feature-requests", type: FORUM, topic: "One thread per request. Vote with reactions." },
    ],
  },
  {
    category: "PRODUCT",
    channels: [
      { name: "payments", type: TEXT, topic: "USDC payments, the 0.5% rail, checkout and settlement on Arbitrum." },
      { name: "cards", type: TEXT, topic: "Stablecoin cards, spending controls and cashback." },
      { name: "travel", type: TEXT, topic: "Furlpay Travels — 2.2M+ stays and flights, paid in stablecoins." },
      { name: "investing", type: TEXT, topic: "Stocks, ETFs, crypto and the investing hub." },
      { name: "security", type: TEXT, topic: "Passkeys, MPC custody and security questions. Report vulnerabilities via furlpay.com/legal/responsible-disclosure." },
    ],
  },
  {
    category: "DEVELOPERS",
    channels: [
      { name: "developer-chat", type: TEXT, topic: "General developer discussion. Docs: furlpay.com/docs" },
      { name: "api-support", type: FORUM, topic: "One thread per question about the Furlpay APIs." },
      { name: "sdk-support", type: FORUM, topic: "Node, Python, Go and Rust SDK help." },
      { name: "x402-agents", type: TEXT, topic: "Agentic payments — x402, MCP servers and AI agent integrations." },
      { name: "open-source", type: TEXT, topic: "Contributions welcome: github.com/Ashutosh0x/furlpay" },
    ],
  },
  {
    category: "BUILDERS",
    channels: [
      { name: "integrations", type: TEXT, topic: "Building on Furlpay? Coordinate integrations here." },
      { name: "hackathons", type: TEXT, topic: "Hackathons, bounties and build challenges." },
      { name: "grants", type: TEXT, topic: "Grant programs — Arbitrum Foundation, Questbook and beyond." },
    ],
  },
  {
    category: "SUPPORT",
    channels: [
      { name: "help", type: FORUM, topic: "One thread per issue. Include what you tried." },
      { name: "bug-reports", type: FORUM, topic: "Reproducible bugs. Security issues go to responsible disclosure, not here." },
      { name: "status", type: TEXT, topic: "Live status: furlpay.com/status", readOnly: true },
    ],
  },
  {
    category: "EVENTS",
    channels: [
      { name: "office-hours", type: STAGE, topic: "Weekly office hours with the team." },
      { name: "community-voice", type: VOICE, topic: "" },
    ],
  },
];

const WELCOME_EMBED = {
  title: "Welcome to Furlpay",
  color: 0x00e599,
  description: [
    "Furlpay is the on-chain financial operating system — stablecoin payments, travel and investing in one platform.",
    "",
    "**Get started**",
    "• Product: https://furlpay.com",
    "• Developer docs: https://furlpay.com/docs",
    "• Open source: https://github.com/Ashutosh0x/furlpay",
    "",
    "**Find your people**",
    "• Building with the APIs → #developer-chat and #api-support",
    "• AI agents and x402 → #x402-agents",
    "• Booking travel with crypto → #travel",
    "• Just exploring → #general and say hi in #introductions",
    "",
    "Try the bot: /help, /docs, /status, /fees",
  ].join("\n"),
  footer: { text: "Furlpay — build, learn and ship with us" },
};

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const retry = (await res.json()).retry_after ?? 1;
    await new Promise((r) => setTimeout(r, retry * 1000 + 100));
    return req(method, path, body);
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

console.log("Fetching current server state…");
const existingRoles = await req("GET", `/guilds/${GUILD}/roles`);
const existingChannels = await req("GET", `/guilds/${GUILD}/channels`);
const roleByName = new Map(existingRoles.map((r) => [r.name, r]));
const channelByKey = new Map(existingChannels.map((c) => [`${c.parent_id ?? ""}:${c.name}`, c]));
const categoryByName = new Map(
  existingChannels.filter((c) => c.type === CATEGORY).map((c) => [c.name, c])
);

// 1. Roles
for (const role of ROLES) {
  if (roleByName.has(role.name)) {
    console.log(`role exists: ${role.name}`);
    continue;
  }
  await req("POST", `/guilds/${GUILD}/roles`, { ...role, mentionable: false });
  console.log(`role created: ${role.name}`);
}

// 2. Categories + channels
let seededWelcome = false;
for (const group of STRUCTURE) {
  let cat = categoryByName.get(group.category);
  if (!cat) {
    cat = await req("POST", `/guilds/${GUILD}/channels`, { name: group.category, type: CATEGORY });
    categoryByName.set(group.category, cat);
    console.log(`category created: ${group.category}`);
  } else {
    console.log(`category exists: ${group.category}`);
  }

  for (const ch of group.channels) {
    const key = `${cat.id}:${ch.name}`;
    const existing = channelByKey.get(key);
    if (existing) {
      if (ch.topic && existing.topic !== ch.topic && existing.type !== VOICE && existing.type !== STAGE) {
        await req("PATCH", `/channels/${existing.id}`, { topic: ch.topic });
        console.log(`  topic updated: #${ch.name}`);
      } else {
        console.log(`  channel exists: #${ch.name}`);
      }
      continue;
    }

    const payload = {
      name: ch.name,
      type: ch.type,
      parent_id: cat.id,
      topic: ch.type === VOICE || ch.type === STAGE ? undefined : ch.topic,
      permission_overwrites: ch.readOnly ? readOnly(GUILD) : undefined,
    };
    let created;
    try {
      created = await req("POST", `/guilds/${GUILD}/channels`, payload);
    } catch (e) {
      // Announcement/Forum/Stage need Community enabled — fall back gracefully.
      const fallback = ch.type === STAGE ? VOICE : TEXT;
      console.warn(`  #${ch.name}: type ${ch.type} rejected (Community not enabled?) — creating as type ${fallback}`);
      created = await req("POST", `/guilds/${GUILD}/channels`, { ...payload, type: fallback });
    }
    console.log(`  channel created: #${ch.name}`);

    if (ch.name === "welcome" && !seededWelcome) {
      await req("POST", `/channels/${created.id}/messages`, { embeds: [WELCOME_EMBED] });
      seededWelcome = true;
      console.log("  welcome message seeded");
    }
  }
}

console.log("\nDone. Manual follow-ups in Server Settings:");
console.log("  1. Enable Community (unlocks announcement/forum/stage channels + onboarding)");
console.log("  2. Community Onboarding: add the questions and map answers to roles/channels");
console.log("  3. Server Guide: set welcome tasks (read #welcome, pick roles, say hi)");
console.log("  4. Safety Setup: verification level Medium+, explicit content filter on");
