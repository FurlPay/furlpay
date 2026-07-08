// ---------------------------------------------------------------------------
// post.ts — Publish pre-drafted content to LinkedIn.
//
// Posts as YOUR PROFILE by default (w_member_social — approved for this app).
// Company Page posting needs the Community Management API product; pass
// --as org once LinkedIn approves it and the token carries the org scopes.
//
// Usage:
//   npm run post                          # Lists available drafts
//   npm run post -- --draft 0             # Posts draft #0 as your profile
//   npm run post -- --draft 0 --as org    # Posts as the Company Page
//   npm run post -- --text "Hello world"  # Posts custom text
//
// Requires: .env with LINKEDIN_ACCESS_TOKEN (+ LINKEDIN_ORG_ID for --as org)
// ---------------------------------------------------------------------------

import { createPost, type LinkedInPost, type PostAuthor } from "./linkedinApi.js";
import { banner } from "./utils.js";

// ---------------------------------------------------------------------------
// Pre-drafted posts following the Hook-Connection-Value-CTA formula
// from the LinkedIn Growth Strategy playbook.
// ---------------------------------------------------------------------------

const DRAFTS: Array<LinkedInPost & { label: string }> = [
  {
    label: "Agentic Economy — x402 Protocol",
    commentary: `The most active payment customer in 2026 isn't a human.

It's an AI agent.

x402 has already processed $600M in autonomous USDC payments — and most implementations have zero replay protection.

We just published a deep-dive on the 4 attack classes we found and how FurlPay hardens each one:

- Authorization spoofing ($0.000001 for a $10 resource)
- Binding attacks (payment for endpoint A unlocks endpoint B)
- Replay attacks (one $0.01 payment = unlimited API calls)
- Web-layer parsing crashes

Full security analysis in the link below.`,
    visibility: "PUBLIC",
    articleUrl: "https://furlpay.com/blog/five-ways-to-rob-an-ai-agent-securing-x402",
    articleTitle: "Five Ways to Rob an AI Agent: How FurlPay Hardens x402 Payments",
    articleDescription: "x402 moves ~$600M a year in agentic USDC payments — here's how we close authorization, binding, replay, and web-layer holes.",
  },
  {
    label: "Interchange Fee Killer — FurlPay Connect",
    commentary: `Your payment processor is quietly stealing 2.5% to 4% of your revenue.

Every. Single. Transaction.

We built FurlPay Connect to fix this:

- Flat 0.5% settlement fee (vs 2.5-4% interchange)
- Stablecoin rails with local bank deposit (ACH, SEPA, RTP)
- Zero volatility for the merchant (USD/EUR/GBP settlement)
- Single integration — one script tag or TypeScript SDK

For a business processing $1M/month, that's $20K-$35K saved annually.

We're running a closed pilot for mid-market B2B platforms.

Interested? Drop a comment or DM me.`,
    visibility: "PUBLIC",
    articleUrl: "https://furlpay.com/blog/announcing-furlpay-connect",
    articleTitle: "Announcing FurlPay Connect: B2B Stablecoin Settlement at 0.5%",
    articleDescription: "A single-integration gateway that slashes merchant settlement fees to a flat 0.5% and deposits local currency straight into your bank account.",
  },
  {
    label: "Death of the Seed Phrase — WebAuthn",
    commentary: `In 2026, we should NOT still be asking users to write 12 words on paper.

Seed phrases are phishable, losable, and a terrible user experience.

FurlPay replaced them entirely with WebAuthn passkeys.

Your private key never leaves your device's secure hardware chip. No paper. No cloud backup. No phishing vectors.

Touch ID to pay. Face ID to send. That's it.

The engineering deep-dive is in the link below.

#WebAuthn #Passkeys #Web3UX #Fintech`,
    visibility: "PUBLIC",
    articleUrl: "https://furlpay.com/blog/death-of-the-seed-phrase-webauthn",
    articleTitle: "The Death of the Seed Phrase: WebAuthn & Device Trust",
    articleDescription: "How FurlPay replaces 12-word seed phrases with phishing-resistant WebAuthn passkeys bound to your device.",
  },
  {
    label: "Build in Public — Portfolio Heatmap",
    commentary: `Shipping update.

Just built a TradingView-style heatmap into FurlPay's investing dashboard.

200+ US stocks, 60+ ETFs, 100+ crypto assets — all visualized by market cap with real-time color coding.

Red = bleeding. Green = printing.

One glance tells you where capital is flowing today.

This is what happens when you merge the best of Robinhood, INDmoney, and TradingView into one dark-mode premium UI.

Coming soon to furlpay.com/markets

What features would you want in an all-in-one investing and payments app?

#BuildInPublic #Fintech #Investing #Crypto`,
    visibility: "PUBLIC",
  },
  {
    label: "MiCA Compliance — Auto-Swap Engine",
    commentary: `If your platform serves European users and handles stablecoins, you need to read this.

As of July 1, 2026 — MiCA is FULLY in effect.

USDT is restricted across the EEA. Users holding non-compliant stablecoins risk having their cards declined.

FurlPay's Dynamic Compliance Engine solves this automatically:

1. Detects the user's jurisdiction
2. Routes non-compliant tokens through on-chain liquidity
3. Auto-swaps to EURC or USDC (fully authorized EMTs)
4. User spends at Visa terminals without friction

Zero manual intervention. Full regulatory compliance.

How we built it is in the link below.

#MiCA #Stablecoins #Compliance #Fintech`,
    visibility: "PUBLIC",
    articleUrl: "https://furlpay.com/blog/navigating-mica-auto-swaps-eurc-usdc",
    articleTitle: "Navigating MiCA: Why FurlPay Enforces Auto-Swaps to EURC/USDC",
    articleDescription: "With MiCA in full effect, FurlPay's Dynamic Compliance Engine auto-swaps non-compliant stablecoins for EEA users.",
  },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(): { draftIndex: number | null; customText: string | null; as: PostAuthor } {
  const args = process.argv.slice(2);
  let draftIndex: number | null = null;
  let customText: string | null = null;
  let as: PostAuthor = "member";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--draft" && args[i + 1]) draftIndex = parseInt(args[++i], 10);
    if (args[i] === "--text" && args[i + 1]) customText = args[++i];
    if (args[i] === "--as" && args[i + 1]) as = args[++i] === "org" ? "organization" : "member";
  }
  return { draftIndex, customText, as };
}

async function run(): Promise<void> {
  const { draftIndex, customText, as } = parseArgs();

  banner("LinkedIn Content Publisher");

  let post: LinkedInPost;

  if (customText) {
    post = { commentary: customText, visibility: "PUBLIC" };
    console.log("Custom text post:");
    console.log(`   "${customText.slice(0, 100)}…"\n`);
  } else {
    const idx = draftIndex ?? 0;
    if (idx < 0 || idx >= DRAFTS.length) {
      console.log(`❌ Invalid draft index. Available: 0–${DRAFTS.length - 1}\n`);
      console.log("Available drafts:");
      DRAFTS.forEach((d, i) => console.log(`  ${i}: ${d.label}`));
      return;
    }

    const draft = DRAFTS[idx];
    post = draft;
    console.log(`Posting draft #${idx}: ${draft.label}`);
    console.log(`   "${draft.commentary.slice(0, 120)}…"\n`);

    if (!draftIndex && draftIndex !== 0) {
      console.log("Available drafts:");
      DRAFTS.forEach((d, i) => console.log(`  ${i}: ${d.label}`));
      console.log(`\nUse: npm run post -- --draft <index>\n`);
      return;
    }
  }

  console.log(`Publishing to LinkedIn as ${as === "organization" ? "FurlPay Company Page" : "your profile"}…`);
  const result = await createPost(post, as);

  if (result.success) {
    console.log(`\n✅ Published successfully!`);
    console.log(`   Post ID: ${result.id}`);
  } else {
    console.log(`\n❌ Failed to publish: ${result.error}`);
  }
}

run().catch(console.error);
