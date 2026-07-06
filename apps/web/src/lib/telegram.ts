import { CHAIN_REGISTRY, chainStatus } from "@/lib/services/chainRegistry";
import { estimateFees } from "@/lib/services/payments";
import { getSortedPosts } from "@/lib/blog/posts";
import { bySymbol } from "@/lib/markets/catalog";
import { getQuotes } from "@/lib/markets/quotes";
import { generateFlights } from "@/lib/travel/data";
import { searchDocs } from "@/lib/docs/search";

// ---------------------------------------------------------------------------
// Telegram bot for Furlpay — the same command surface as the Discord bot,
// over the Telegram Bot API. Runs webhook-first (POST /api/telegram/webhook)
// so it needs no always-on process: Telegram delivers each update, we reply
// in the webhook response. Replies use HTML parse mode + inline keyboards
// (link buttons). Proactive posts to @furlpayofficial use sendToChat().
// Docs: core.telegram.org/bots/api
// ---------------------------------------------------------------------------

const SITE = "https://furlpay.com";
export const TG_API = (method: string) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

// Escape the five HTML-sensitive chars for Telegram parse_mode=HTML.
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Button {
  text: string;
  url: string;
}
function keyboard(...rows: Button[][]) {
  return { inline_keyboard: rows };
}

export interface TgUpdate {
  message?: {
    message_id: number;
    text?: string;
    chat: { id: number; type: string };
    from?: { first_name?: string; username?: string };
  };
}

// A webhook reply: returned as the HTTP response so Telegram executes it in the
// same round trip (no bot token needed for the reply itself).
type TgReply = Record<string, unknown> & { method: string; chat_id: number };

function sendMessage(chatId: number, text: string, buttons?: ReturnType<typeof keyboard>): TgReply {
  return {
    method: "sendMessage",
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: buttons } : {}),
  };
}

// Parse "/flights@FurlPayBot LHR JFK 2026-08-01" → { cmd:"flights", args:[...] }
function parse(text: string): { cmd: string; args: string[] } {
  const parts = text.trim().split(/\s+/);
  const cmd = (parts[0] || "").replace(/^\//, "").split("@")[0].toLowerCase();
  return { cmd, args: parts.slice(1) };
}

export async function handleUpdate(update: TgUpdate): Promise<TgReply | null> {
  const msg = update.message;
  if (!msg?.text || !msg.text.startsWith("/")) return null;
  const chatId = msg.chat.id;
  const { cmd, args } = parse(msg.text);
  const name = msg.from?.first_name || "there";

  switch (cmd) {
    case "start":
      return sendMessage(
        chatId,
        `<b>Welcome to Furlpay, ${esc(name)}</b>\n\nThe on-chain financial operating system — stablecoin payments, travel and investing in one app.\n\nTry <b>/flights</b>, <b>/ask</b>, <b>/quote</b>, <b>/fees</b>, or <b>/help</b> for everything.`,
        keyboard(
          [{ text: "Open App", url: `${SITE}/dashboard` }, { text: "Developer Docs", url: `${SITE}/docs` }],
          [{ text: "GitHub", url: "https://github.com/Ashutosh0x/furlpay" }]
        )
      );

    case "help":
      return sendMessage(
        chatId,
        [
          "<b>Furlpay commands</b>",
          "/flights LHR JFK — search flights, pay in USDC",
          "/ask &lt;question&gt; — ask the docs",
          "/quote BTC — live crypto price",
          "/status — network status (Arbitrum first)",
          "/fees 150 — USDC payment cost vs cards",
          "/blog — latest posts",
          "/roadmap — what we are building",
          "/travel — book stays and flights",
          "/github — open-source repos",
        ].join("\n"),
        keyboard([{ text: "Get started", url: `${SITE}/start` }])
      );

    case "status": {
      const statuses = await Promise.all(CHAIN_REGISTRY.map(chainStatus));
      const lines = statuses
        .map((s) => `• <b>${esc(s.name)}</b> — block ${s.blockHeight.toLocaleString("en-US")} · ${s.healthy ? "healthy" : "degraded"}`)
        .join("\n");
      return sendMessage(chatId, `<b>Network status</b>\nPrimary settlement: Arbitrum One.\n\n${lines}`);
    }

    case "fees": {
      const amount = Number(args[0]) || 150;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
        return sendMessage(chatId, "Usage: /fees 150");
      }
      const q = await estimateFees(amount, "arbitrum");
      return sendMessage(
        chatId,
        [
          `<b>What a $${amount.toLocaleString("en-US")} payment costs</b>`,
          `Furlpay fee (0.5%): <b>$${q.furlpayFeeUsdc.toFixed(2)}</b>`,
          `Gas (Arbitrum): $${q.gasEstimateUsd.toFixed(4)}`,
          `Card rails (up to 3.5%): $${q.cardInterchangeComparisonUsd.toFixed(2)}`,
          `You save: <b>$${q.savingsVsCardsUsd.toFixed(2)}</b>`,
        ].join("\n")
      );
    }

    case "quote": {
      const symbol = (args[0] || "").toUpperCase();
      const asset = bySymbol.get(symbol);
      if (!asset) return sendMessage(chatId, "Usage: /quote BTC");
      const quotes = await getQuotes();
      const p = quotes.get(symbol) ?? { price: 0, changePct: 0, live: false };
      const arrow = p.changePct >= 0 ? "▲" : "▼";
      return sendMessage(
        chatId,
        `<b>${esc(asset.name)} (${symbol})</b>\n$${p.price.toLocaleString("en-US", { maximumFractionDigits: 6 })} · ${arrow} ${Math.abs(p.changePct).toFixed(2)}% (24h)`,
        keyboard([{ text: `View ${symbol}`, url: `${SITE}/markets/${symbol}` }])
      );
    }

    case "flights": {
      const from = (args[0] || "").toUpperCase().slice(0, 3);
      const to = (args[1] || "").toUpperCase().slice(0, 3);
      const date = args[2] || new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
      if (from.length !== 3 || to.length !== 3) {
        return sendMessage(chatId, "Usage: /flights LHR JFK 2026-08-01");
      }
      const flights = generateFlights(from, to, date).sort((a, b) => a.priceUsd - b.priceUsd).slice(0, 5);
      const lines = flights
        .map((f) => {
          const dur = `${Math.floor(f.durationMin / 60)}h ${f.durationMin % 60}m`;
          const stops = f.stops === 0 ? "nonstop" : `${f.stops} stop`;
          return `<b>$${f.priceUsd}</b> · ${esc(f.carrier)} ${f.departTime}→${f.arriveTime} · ${dur} · ${stops}`;
        })
        .join("\n");
      return sendMessage(
        chatId,
        `<b>Flights ${from} → ${to}</b>\n${date} · pay in USDC, earn 2% cashback\n\n${lines}`,
        keyboard([{ text: "Book on Furlpay", url: `${SITE}/travel/flights?from=${from}&to=${to}&date=${date}` }])
      );
    }

    case "ask": {
      const q = args.join(" ").trim();
      const hits = q ? searchDocs(q, 3) : [];
      if (!hits.length) {
        return sendMessage(chatId, `No docs matched "${esc(q)}". Browse all docs below.`, keyboard([{ text: "All docs", url: `${SITE}/docs` }]));
      }
      const top = hits[0];
      const more = hits.slice(1).map((h) => `• <a href="${SITE}${h.href}">${esc(h.title)}</a>`).join("\n");
      return sendMessage(
        chatId,
        `<b>${esc(top.title)}</b>\n${esc(top.snippet)}${more ? `\n\n${more}` : ""}`,
        keyboard([{ text: "Open docs", url: `${SITE}${top.href}` }])
      );
    }

    case "blog": {
      const posts = getSortedPosts().slice(0, 3);
      const lines = posts.map((p) => `• <a href="${SITE}/blog/${p.slug}">${esc(p.title)}</a>`).join("\n");
      return sendMessage(chatId, `<b>Latest from the Furlpay blog</b>\n${lines}`);
    }

    case "roadmap":
      return sendMessage(
        chatId,
        [
          "<b>What Furlpay is building next</b>",
          "• Contracts live on Arbitrum (Sepolia → One)",
          "• End-to-end agentic booking via x402 + MCP",
          "• Merchant rail: checkout, payouts, webhooks",
          "• Passkey smart wallets, gasless via paymaster",
        ].join("\n"),
        keyboard([{ text: "Follow the blog", url: `${SITE}/blog` }, { text: "Talk to us", url: `${SITE}/talk-to-us` }])
      );

    case "travel":
      return sendMessage(
        chatId,
        "<b>Furlpay Travels</b>\nBook 2.2M+ stays and flights across 230+ countries, pay in USDC, earn 2% cashback.",
        keyboard([{ text: "Explore travel", url: `${SITE}/travel` }])
      );

    case "github":
      return sendMessage(
        chatId,
        "<b>Furlpay open source</b>\nMIT-licensed SDKs, x402-guard, agent-trust, and Arbitrum contracts.",
        keyboard([{ text: "GitHub", url: "https://github.com/Ashutosh0x/furlpay" }])
      );

    default:
      return null; // ignore unknown commands (esp. in groups)
  }
}

/** Proactive post to a chat/channel (needs TELEGRAM_BOT_TOKEN). Used for
 *  announcements to @furlpayofficial and GitHub changelog cross-posting. */
export async function sendToChat(chatId: string | number, html: string, buttons?: Button[][]): Promise<boolean> {
  const res = await fetch(TG_API("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    }),
  });
  return res.ok;
}
