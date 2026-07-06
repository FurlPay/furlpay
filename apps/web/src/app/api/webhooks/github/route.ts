import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/webhooks/github — GitHub → Discord forwarder. GitHub signs each
// delivery with HMAC-SHA256 (X-Hub-Signature-256) using GITHUB_WEBHOOK_SECRET;
// we verify it, format the event as a branded embed, and post to the Discord
// channel webhook (DISCORD_GITHUB_WEBHOOK_URL — the #changelog webhook).
//
// Setup:
//   1. Vercel env: GITHUB_WEBHOOK_SECRET (any strong random string) and
//      DISCORD_GITHUB_WEBHOOK_URL (the #changelog webhook URL).
//   2. GitHub repo → Settings → Webhooks → Add webhook:
//        Payload URL: https://furlpay.com/api/webhooks/github
//        Content type: application/json
//        Secret: <same GITHUB_WEBHOOK_SECRET>
//        Events: Releases, Pushes, Pull requests, Security advisories.

const BRAND_GREEN = 0x00e599;
const RED = 0xed4245;

function verify(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface Embed {
  title: string;
  url?: string;
  description?: string;
  color: number;
  author?: { name: string; icon_url?: string };
  footer?: { text: string };
}

function buildEmbed(event: string, p: any): Embed | null {
  const repo = p?.repository?.full_name ?? "furlpay";
  const actor = p?.sender?.login;
  const author = actor ? { name: actor, icon_url: p.sender.avatar_url } : undefined;

  switch (event) {
    case "release":
      if (p.action !== "published") return null;
      return {
        title: `Release ${p.release.tag_name} — ${p.release.name || repo}`,
        url: p.release.html_url,
        description: (p.release.body || "New release published.").slice(0, 1500),
        color: BRAND_GREEN,
        author,
        footer: { text: repo },
      };
    case "push": {
      const branch = String(p.ref || "").replace("refs/heads/", "");
      const commits: any[] = p.commits || [];
      if (!commits.length) return null;
      const lines = commits
        .slice(0, 8)
        .map((c) => `\`${c.id.slice(0, 7)}\` ${c.message.split("\n")[0].slice(0, 90)}`)
        .join("\n");
      return {
        title: `${commits.length} commit${commits.length > 1 ? "s" : ""} to ${branch}`,
        url: p.compare,
        description: lines,
        color: BRAND_GREEN,
        author,
        footer: { text: repo },
      };
    }
    case "pull_request": {
      if (!["opened", "closed", "reopened"].includes(p.action)) return null;
      const merged = p.action === "closed" && p.pull_request.merged;
      const verb = merged ? "merged" : p.action;
      return {
        title: `PR #${p.number} ${verb}: ${p.pull_request.title}`.slice(0, 240),
        url: p.pull_request.html_url,
        color: merged ? BRAND_GREEN : 0x9b59b6,
        author,
        footer: { text: repo },
      };
    }
    case "security_advisory":
    case "repository_advisory":
      return {
        title: `Security advisory: ${p.security_advisory?.summary ?? p.advisory?.summary ?? "update"}`.slice(0, 240),
        description: (p.security_advisory?.description ?? p.advisory?.description ?? "").slice(0, 1500),
        color: RED,
        footer: { text: repo },
      };
    case "ping":
      return { title: "GitHub webhook connected", description: "Furlpay changelog feed is live.", color: BRAND_GREEN, footer: { text: repo } };
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const target = process.env.DISCORD_GITHUB_WEBHOOK_URL;
  if (!secret || !target) {
    return NextResponse.json({ error: "forwarder_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verify(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event") || "unknown";
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const embed = buildEmbed(event, payload);
  if (!embed) return NextResponse.json({ received: true, forwarded: false });

  const res = await fetch(target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "Furlpay GitHub", embeds: [embed] }),
  });

  // Cross-post to the Telegram channel when configured (bot token + channel).
  let telegram = false;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.TELEGRAM_CHANNEL_ID; // e.g. @furlpayofficial
  if (tgToken && tgChat) {
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const text = `<b>${escHtml(embed.title)}</b>${embed.url ? `\n${embed.url}` : ""}${
      embed.description ? `\n\n${escHtml(embed.description).slice(0, 800)}` : ""
    }`;
    const tg = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: tgChat, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    telegram = tg.ok;
  }

  return NextResponse.json({ received: true, forwarded: res.ok, telegram });
}
