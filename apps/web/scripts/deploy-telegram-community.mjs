// Furlpay Telegram community as code — creates forum topics and pins the
// community rules in the group, mirroring the Discord deploy script.
//
// Prerequisites (manual, one-time, compliant — no auto-invites):
//   1. Add @FurlpayBot to the group as ADMIN with "Manage Topics" +
//      "Pin Messages" + "Delete Messages".
//   2. Enable Topics: group → Manage → Topics → on.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=<token> TELEGRAM_GROUP_ID=-1004236205892 \
//   node scripts/deploy-telegram-community.mjs
//
// Bot API cannot list existing topics, so this is a create-once script; it
// writes the created topic thread IDs to telegram-topics.json. Re-running
// would create duplicates — edit/extend the TOPICS list and rerun only the
// additions, or delete duplicates by hand.

import fs from "fs";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP = process.env.TELEGRAM_GROUP_ID;
if (!TOKEN || !GROUP) {
  console.error("Set TELEGRAM_BOT_TOKEN and TELEGRAM_GROUP_ID.");
  process.exit(1);
}
const api = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;
async function call(method, body) {
  const res = await fetch(api(method), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

// Telegram's fixed forum-icon palette.
const BLUE = 7322096, YELLOW = 16766590, PURPLE = 13338331, GREEN = 9367192, PINK = 16749490, RED = 16478047;

// A tight, product-aligned topic set — deliberately not 14; a small community
// reads as active when conversation concentrates, not fragments.
const TOPICS = [
  { name: "Payments & Cards", icon_color: BLUE },
  { name: "Travel", icon_color: GREEN },
  { name: "Investing", icon_color: YELLOW },
  { name: "Developers", icon_color: PURPLE },
  { name: "AI Agents & MCP", icon_color: PINK },
  { name: "Support", icon_color: BLUE },
  { name: "Bug Reports", icon_color: RED },
  { name: "Feature Requests", icon_color: YELLOW },
  { name: "Showcase", icon_color: GREEN },
];

const RULES = [
  "<b>Furlpay community rules</b>",
  "",
  "1. Be respectful. No harassment.",
  "2. No spam, shilling, or unsolicited DMs.",
  "3. No scams, fake airdrops, or “discount booking” offers — instant ban.",
  "4. Stay on topic — use the right topic for your message.",
  "5. Security issues: report privately via furlpay.com/legal/responsible-disclosure, not here.",
  "6. English preferred so everyone can follow.",
  "",
  "New here? Chat with @FurlpayBot — try /help, /flights, /ask.",
].join("\n");

// Verify the bot can manage topics before doing anything.
const me = await call("getMe", {});
const member = await call("getChatMember", { chat_id: GROUP, user_id: me.id });
if (member.status !== "administrator" || !member.can_manage_topics) {
  console.error(
    `@${me.username} needs to be a group admin with "Manage Topics". Current status: ${member.status}, can_manage_topics: ${member.can_manage_topics}`
  );
  process.exit(1);
}

const created = {};
for (const t of TOPICS) {
  const topic = await call("createForumTopic", { chat_id: GROUP, name: t.name, icon_color: t.icon_color });
  created[t.name] = topic.message_thread_id;
  console.log(`topic created: ${t.name} (thread ${topic.message_thread_id})`);
}

// Post + pin the rules in the General topic (no message_thread_id = General).
const rulesMsg = await call("sendMessage", {
  chat_id: GROUP,
  text: RULES,
  parse_mode: "HTML",
  disable_web_page_preview: true,
});
await call("pinChatMessage", { chat_id: GROUP, message_id: rulesMsg.message_id, disable_notification: true });
console.log("rules posted and pinned in General.");

fs.writeFileSync(
  new URL("./telegram-topics.json", import.meta.url),
  JSON.stringify({ group: GROUP, topics: created, updated: new Date().toISOString() }, null, 2)
);
console.log("\nSaved thread IDs → scripts/telegram-topics.json");
console.log("Next: set the group as the channel's Discussion Group so channel posts open comment threads here.");
