import crypto from "crypto";
import { CHAIN_REGISTRY, chainStatus } from "@/lib/services/chainRegistry";
import { estimateFees } from "@/lib/services/payments";
import { getSortedPosts } from "@/lib/blog/posts";

// ---------------------------------------------------------------------------
// Discord HTTP interactions for the Furlpay app (Application ID in env).
// Discord POSTs every slash command to /api/discord/interactions with an
// Ed25519 signature over (timestamp + raw body); invalid signatures MUST get
// a 401 — Discord probes with deliberately bad ones. PING (type 1) answers
// PONG (type 1); commands answer within 3 seconds.
// Docs: docs.discord.com/developers/interactions/overview
// ---------------------------------------------------------------------------

// The application's public key from the Developer Portal (General Information).
const DISCORD_PUBLIC_KEY =
  process.env.DISCORD_PUBLIC_KEY ||
  "290754987eb82bfcb0d16abe8f92ee5c3c5a818610189a10cbc082eacf53902d";

// Interaction types
export const PING = 1;
export const APPLICATION_COMMAND = 2;
// Callback types
export const PONG = 1;
export const CHANNEL_MESSAGE_WITH_SOURCE = 4;

const EPHEMERAL = 1 << 6;
const BRAND_GREEN = 0x00e599;
const SITE = "https://furlpay.com";

/** Verify Discord's Ed25519 signature over timestamp + raw body. */
export function verifyDiscordSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null
): boolean {
  if (!signature || !timestamp) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signature)) return false;
  try {
    // node:crypto needs the raw 32-byte key wrapped as DER SPKI.
    const spki = Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.from(DISCORD_PUBLIC_KEY, "hex"),
    ]);
    const key = crypto.createPublicKey({ key: spki, format: "der", type: "spki" });
    return crypto.verify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signature, "hex")
    );
  } catch {
    return false;
  }
}

// --- Slash command handlers --------------------------------------------------

interface CommandOption {
  name: string;
  value?: string | number;
}
export interface Interaction {
  type: number;
  data?: { name?: string; options?: CommandOption[] };
}

type Reply = { type: number; data: Record<string, unknown> };

function reply(data: Record<string, unknown>): Reply {
  return { type: CHANNEL_MESSAGE_WITH_SOURCE, data };
}

function embed(title: string, description: string, fields?: { name: string; value: string; inline?: boolean }[]) {
  return {
    title,
    description,
    color: BRAND_GREEN,
    fields,
    footer: { text: "Furlpay — the on-chain financial operating system" },
  };
}

function opt(i: Interaction, name: string): string | number | undefined {
  return i.data?.options?.find((o) => o.name === name)?.value;
}

const DOC_TOPICS: Record<string, { label: string; url: string }> = {
  payments: { label: "Payments API", url: `${SITE}/docs` },
  x402: { label: "x402 agentic payments", url: `${SITE}/developer` },
  travel: { label: "Travel booking API", url: `${SITE}/travel` },
  sdks: { label: "SDKs (Node, Python, Go, Rust)", url: `${SITE}/developer` },
  agents: { label: "For AI Agents quickstart", url: `${SITE}/docs` },
};

export async function handleCommand(i: Interaction): Promise<Reply> {
  const name = i.data?.name ?? "";

  switch (name) {
    case "help":
      return reply({
        embeds: [
          embed("Furlpay commands", "Everything the Furlpay app can do from Discord:", [
            { name: "/docs [topic]", value: "Developer documentation links", inline: true },
            { name: "/status", value: "Live chain status (Arbitrum first)", inline: true },
            { name: "/fees <amount>", value: "USDC payment fee vs card rails", inline: true },
            { name: "/blog", value: "Latest from the Furlpay blog", inline: true },
            { name: "/github", value: "Open-source repos and SDKs", inline: true },
            { name: "/travel", value: "Book stays and flights with USDC", inline: true },
          ]),
        ],
        flags: EPHEMERAL,
      });

    case "docs": {
      const topic = String(opt(i, "topic") ?? "");
      const t = DOC_TOPICS[topic];
      if (t) {
        return reply({ embeds: [embed(t.label, `Read the ${t.label} documentation: ${t.url}`)], flags: EPHEMERAL });
      }
      return reply({
        embeds: [
          embed(
            "Furlpay developer docs",
            `Docs: ${SITE}/docs\nDeveloper portal & Agent Console: ${SITE}/developer`,
            Object.entries(DOC_TOPICS).map(([k, v]) => ({ name: `/docs ${k}`, value: v.label, inline: true }))
          ),
        ],
        flags: EPHEMERAL,
      });
    }

    case "status": {
      const statuses = await Promise.all(CHAIN_REGISTRY.map(chainStatus));
      return reply({
        embeds: [
          embed(
            "Network status",
            "Chains Furlpay settles or reads on. Primary settlement: Arbitrum One.",
            statuses.map((s) => ({
              name: s.name,
              value: `block ${s.blockHeight.toLocaleString("en-US")} · ${s.healthy ? "healthy" : "degraded"}`,
              inline: true,
            }))
          ),
        ],
      });
    }

    case "fees": {
      const amount = Number(opt(i, "amount") ?? 150);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
        return reply({ content: "Enter an amount between 0 and 1,000,000 USD.", flags: EPHEMERAL });
      }
      const q = await estimateFees(amount, "arbitrum");
      return reply({
        embeds: [
          embed(`What a $${amount.toLocaleString("en-US")} payment costs`, "Furlpay USDC rail on Arbitrum vs typical card acceptance:", [
            { name: "Furlpay fee (0.5%)", value: `$${q.furlpayFeeUsdc.toFixed(2)}`, inline: true },
            { name: "Gas (Arbitrum)", value: `$${q.gasEstimateUsd.toFixed(4)}`, inline: true },
            { name: "Card rails (up to 3.5%)", value: `$${q.cardInterchangeComparisonUsd.toFixed(2)}`, inline: true },
            { name: "Merchant saves", value: `$${q.savingsVsCardsUsd.toFixed(2)}`, inline: true },
          ]),
        ],
      });
    }

    case "blog": {
      const posts = getSortedPosts().slice(0, 3);
      return reply({
        embeds: [
          embed(
            "Latest from the Furlpay blog",
            posts.map((p) => `**${p.title}**\n${SITE}/blog/${p.slug}`).join("\n\n")
          ),
        ],
      });
    }

    case "github":
      return reply({
        embeds: [
          embed("Furlpay open source", "MIT-licensed packages, SDKs and contracts:", [
            { name: "Monorepo", value: "https://github.com/Ashutosh0x/furlpay" },
            { name: "Highlights", value: "x402-guard · agent-trust · account-kit · Solidity contracts (Arbitrum) · SDKs in Node, Python, Go, Rust" },
          ]),
        ],
        flags: EPHEMERAL,
      });

    case "travel":
      return reply({
        embeds: [
          embed(
            "Furlpay Travels",
            `Book 2.2M+ stays and flights across 230+ countries, pay in USDC, earn 2% cashback.\n${SITE}/travel`
          ),
        ],
      });

    default:
      return reply({ content: `Unknown command. Try /help.`, flags: EPHEMERAL });
  }
}
