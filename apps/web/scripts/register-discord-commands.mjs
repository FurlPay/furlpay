// Registers Furlpay's global slash commands with Discord.
// Run once after any command change:
//   DISCORD_APP_ID=... DISCORD_TOKEN=... node scripts/register-discord-commands.mjs
// DISCORD_TOKEN is the Bot token (Developer Portal → Bot → Reset Token).
// Global commands can take up to ~1 hour to propagate to all servers.

const APP_ID = process.env.DISCORD_APP_ID || "1523364052116705400";
const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error("Set DISCORD_TOKEN (bot token from the Developer Portal → Bot tab).");
  process.exit(1);
}

const commands = [
  { name: "help", description: "What the Furlpay bot can do" },
  {
    name: "docs",
    description: "Furlpay developer documentation",
    options: [
      {
        type: 3, // STRING
        name: "topic",
        description: "Jump straight to a topic",
        required: false,
        choices: [
          { name: "Payments API", value: "payments" },
          { name: "x402 agentic payments", value: "x402" },
          { name: "Travel API", value: "travel" },
          { name: "SDKs", value: "sdks" },
          { name: "AI agents quickstart", value: "agents" },
        ],
      },
    ],
  },
  { name: "status", description: "Live network status — Arbitrum, Base, Ethereum and more" },
  {
    name: "fees",
    description: "What a USDC payment costs vs card rails",
    options: [
      {
        type: 10, // NUMBER
        name: "amount",
        description: "Payment amount in USD (default 150)",
        required: false,
        min_value: 1,
        max_value: 1000000,
      },
    ],
  },
  { name: "blog", description: "Latest posts from the Furlpay blog" },
  { name: "github", description: "Furlpay open-source repos and SDKs" },
  { name: "travel", description: "Book stays and flights with USDC" },
];

const res = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
  method: "PUT", // bulk overwrite — removes commands not in this list
  headers: {
    Authorization: `Bot ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`Failed (${res.status}):`, await res.text());
  process.exit(1);
}
const registered = await res.json();
console.log(`Registered ${registered.length} global commands:`);
for (const c of registered) console.log(`  /${c.name} — ${c.description}`);
