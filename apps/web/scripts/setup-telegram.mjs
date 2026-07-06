// Wires up the Furlpay Telegram bot: registers the command menu and points
// Telegram's webhook at furlpay.com with a shared secret.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=<from @BotFather> \
//   TELEGRAM_WEBHOOK_SECRET=<same value set in Vercel> \
//   node scripts/setup-telegram.mjs
//
// The webhook secret must match TELEGRAM_WEBHOOK_SECRET in the deployed app,
// or the endpoint will 401 every update.

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || "https://furlpay.com/api/telegram/webhook";
if (!TOKEN || !SECRET) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET.");
  process.exit(1);
}

const api = (method) => `https://api.telegram.org/bot${TOKEN}/${method}`;

async function call(method, body) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${JSON.stringify(json)}`);
  return json.result;
}

const commands = [
  { command: "start", description: "Get started with Furlpay" },
  { command: "help", description: "All commands" },
  { command: "flights", description: "Search flights, pay in USDC — /flights LHR JFK" },
  { command: "ask", description: "Ask the docs — /ask how does x402 work" },
  { command: "quote", description: "Live crypto price — /quote BTC" },
  { command: "status", description: "Network status (Arbitrum first)" },
  { command: "fees", description: "USDC payment cost vs cards — /fees 150" },
  { command: "blog", description: "Latest posts" },
  { command: "roadmap", description: "What we are building" },
  { command: "travel", description: "Book stays and flights" },
  { command: "github", description: "Open-source repos" },
];

// Identify the bot
const me = await call("getMe", {});
console.log(`Bot: @${me.username} (${me.first_name})`);

// Register the command menu
await call("setMyCommands", { commands });
console.log(`Registered ${commands.length} commands.`);

// Point the webhook at furlpay.com with the shared secret
await call("setWebhook", {
  url: WEBHOOK_URL,
  secret_token: SECRET,
  allowed_updates: ["message"],
  drop_pending_updates: true,
});
console.log(`Webhook set → ${WEBHOOK_URL}`);

const info = await call("getWebhookInfo", {});
console.log("Webhook status:", JSON.stringify({ url: info.url, pending: info.pending_update_count, last_error: info.last_error_message ?? null }));
console.log("\nDone. Message the bot /start to test. To post to @furlpayofficial, add the bot as a channel admin.");
