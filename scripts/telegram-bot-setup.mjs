#!/usr/bin/env node
// FurlPay Telegram bot setup — the parts the Bot API can do. Read-only unless
// --apply is given; idempotent when it is.
//
//   npm run telegram:setup                     # status: who the bot is, menu button, commands, webhook health
//   npm run telegram:setup -- menu             # show the menu-button change it WOULD make
//   npm run telegram:setup -- menu --apply     # set it (web_app "Open FurlPay" → TELEGRAM_MINI_APP_URL)
//   npm run telegram:setup -- commands --apply # publish the commands the webhook actually handles
//
// What it will NOT do:
//   - register, change or delete the webhook. @FurlpayBot already has one
//     (/api/telegram/webhook, secret-token verified); setWebhook is never called.
//   - enable the Main Mini App or create a direct link: those are BotFather-only
//     (Bot Settings → Configure Mini App). See docs/telegram-mini-app-deployment.md.
//
// Secrets: TELEGRAM_BOT_TOKEN is read from the environment only (never an
// argument, never a file), and is redacted from every line this prints.

import { pathToFileURL } from "node:url";

export const EXPECTED_BOT_USERNAME = "FurlpayBot";
export const APPROVED_ORIGINS = ["https://furlpay.com"];
export const MENU_TEXT = "Open FurlPay";

/** Mirrors the `switch (cmd)` in apps/web/src/lib/telegram.ts — publish nothing the bot does not answer. */
export const BOT_COMMANDS = [
  { command: "start", description: "Welcome and quick links" },
  { command: "help", description: "Everything the bot can do" },
  { command: "flights", description: "Search flights, pay in USDC" },
  { command: "ask", description: "Ask the FurlPay docs" },
  { command: "quote", description: "Live crypto price" },
  { command: "fees", description: "USDC payment cost vs cards" },
  { command: "status", description: "Network status" },
  { command: "travel", description: "Stays and flights" },
  { command: "blog", description: "Latest posts" },
  { command: "roadmap", description: "What we are building" },
  { command: "github", description: "Open-source repos" },
];

/** HTTPS, an approved origin, no credentials or fragment. Returns the normalised URL or throws. */
export function validateMiniAppUrl(raw, approved = APPROVED_ORIGINS) {
  if (!raw) throw new Error("TELEGRAM_MINI_APP_URL is not set (e.g. https://furlpay.com/telegram).");
  let url;
  try { url = new URL(raw); } catch { throw new Error("TELEGRAM_MINI_APP_URL is not a valid URL."); }
  if (url.protocol !== "https:") throw new Error("TELEGRAM_MINI_APP_URL must use https (Telegram requires it).");
  if (url.username || url.password) throw new Error("TELEGRAM_MINI_APP_URL must not contain credentials.");
  if (url.hash) throw new Error("TELEGRAM_MINI_APP_URL must not contain a #fragment (Telegram appends launch data there).");
  if (!approved.includes(url.origin)) throw new Error(`TELEGRAM_MINI_APP_URL origin ${url.origin} is not approved (${approved.join(", ")}). Pass --allow-origin=<origin> to approve a preview explicitly.`);
  return url.toString();
}

/** Replace every occurrence of the token (and the /bot<token>/ path form) with a marker. */
export function redact(text, token) {
  let out = String(text);
  if (token) out = out.split(token).join("<redacted-token>");
  return out.replace(/bot\d+:[A-Za-z0-9_-]{20,}/g, "bot<redacted-token>");
}

/** True when two command lists are the same set in the same order. */
export function sameCommands(a = [], b = []) {
  return a.length === b.length && a.every((c, i) => c.command === b[i].command && c.description === b[i].description);
}

function args(argv) {
  const out = { action: "status", apply: false, allow: [] };
  for (const a of argv) {
    if (a === "--apply") out.apply = true;
    else if (a.startsWith("--allow-origin=")) out.allow.push(a.slice("--allow-origin=".length));
    else if (!a.startsWith("-")) out.action = a;
    else throw new Error(`Unknown option ${a}`);
  }
  if (!["status", "menu", "commands"].includes(out.action)) throw new Error(`Unknown action "${out.action}" (status | menu | commands).`);
  return out;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const say = (line) => console.log(redact(line, token));
  if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) {
    console.error("TELEGRAM_BOT_TOKEN is missing or malformed. Set it in your shell (read -rs) — never pass it as an argument.");
    process.exit(2);
  }
  const opts = args(process.argv.slice(2));
  const call = async (method, body) => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
    if (!json.ok) throw new Error(`${method} failed: ${json.description ?? res.status}`);
    return json.result;
  };

  const me = await call("getMe");
  say(`bot          @${me.username} (id ${me.id})`);
  if (me.username !== EXPECTED_BOT_USERNAME) {
    console.error(`This token belongs to @${me.username}, not @${EXPECTED_BOT_USERNAME}. Refusing to continue.`);
    process.exit(3);
  }

  if (opts.action === "status") {
    const menu = await call("getChatMenuButton");
    say(`menu button  ${menu.type}${menu.type === "web_app" ? ` "${menu.text}" → ${menu.web_app?.url}` : ""}`);
    const cmds = await call("getMyCommands");
    say(`commands     ${cmds.length ? cmds.map((c) => "/" + c.command).join(" ") : "(none)"}`);
    const hook = await call("getWebhookInfo");
    const host = hook.url ? new URL(hook.url).host + new URL(hook.url).pathname : "(not set)";
    say(`webhook      ${host} · pending ${hook.pending_update_count ?? 0}${hook.last_error_message ? ` · last error: ${hook.last_error_message}` : ""} (never changed by this script)`);
    say("Main Mini App and direct links are configured in BotFather only.");
    return;
  }

  if (opts.action === "menu") {
    const url = validateMiniAppUrl(process.env.TELEGRAM_MINI_APP_URL, [...APPROVED_ORIGINS, ...opts.allow]);
    const desired = { type: "web_app", text: MENU_TEXT, web_app: { url } };
    const current = await call("getChatMenuButton");
    if (current.type === "web_app" && current.text === MENU_TEXT && current.web_app?.url === url) { say(`menu button already "${MENU_TEXT}" → ${url} (no change)`); return; }
    say(`menu button  ${current.type} → web_app "${MENU_TEXT}" → ${url}`);
    if (!opts.apply) { say("dry run: re-run with --apply to set it"); return; }
    await call("setChatMenuButton", { menu_button: desired });
    say("menu button set");
    return;
  }

  // commands
  const current = await call("getMyCommands");
  if (sameCommands(current, BOT_COMMANDS)) { say("commands already published (no change)"); return; }
  say(`commands     ${current.map((c) => "/" + c.command).join(" ") || "(none)"} → ${BOT_COMMANDS.map((c) => "/" + c.command).join(" ")}`);
  if (!opts.apply) { say("dry run: re-run with --apply to publish"); return; }
  await call("setMyCommands", { commands: BOT_COMMANDS });
  say("commands published");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(redact(e?.message ?? e, process.env.TELEGRAM_BOT_TOKEN));
    process.exit(1);
  });
}
