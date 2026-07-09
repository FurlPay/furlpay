import { shell } from "./email";

// ---------------------------------------------------------------------------
// Transactional email templates — one function per user-facing send, each
// returning { subject, html, text } for sendEmail(). All render inside the
// shared shell() (brand header, anti-phishing footer). Marketing/ops templates
// (newsletter, creator program, lead notifications) live in email.ts.
//
// Brand voice: professional, no emojis, one primary action per email.
// ---------------------------------------------------------------------------

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const p = (content: string) =>
  `<p style="font-size:14px;line-height:1.6;color:#bbb;margin:0 0 12px">${content}</p>`;

const row = (label: string, value: string) =>
  `<tr>
    <td style="font-size:13px;color:#888;padding:6px 0">${label}</td>
    <td style="font-size:13px;color:#ddd;padding:6px 0;text-align:right">${value}</td>
  </tr>`;

const detailsTable = (rows: string) =>
  `<table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}</table>`;

/** Large centered code/reference block (OTP codes, booking locators). */
const codeBox = (value: string) =>
  `<div style="background:rgba(0,229,153,.08);border:1px solid rgba(0,229,153,.2);border-radius:12px;padding:20px;text-align:center;margin:16px 0">
    <span style="color:#00E599;font-size:32px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,monospace">${value}</span>
  </div>`;

const cta = (href: string, label: string) =>
  `<p style="margin:20px 0 4px"><a href="${href}" style="display:inline-block;background:#00E599;color:#000;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:24px">${label}</a></p>`;

/** Large money/stat spotlight — white, tight tracking (codeBox's wide
 *  letter-spacing is for OTP codes, not amounts). */
const spotlight = (value: string, sub?: string) =>
  `<div style="text-align:center;margin:16px 0 20px">
    <div style="color:#fff;font-size:36px;font-weight:700;letter-spacing:-.02em;line-height:1.2">${value}</div>
    ${sub ? `<div style="font-size:13px;color:#888;margin-top:4px">${sub}</div>` : ""}
  </div>`;

/** Product feature line-item (welcome/KYC emails). Table-based; the rounded
 *  border degrades gracefully where unsupported (Outlook). */
const featureRow = (title: string, desc: string) =>
  `<tr><td style="padding:12px 16px;background:rgba(0,229,153,.05);border:1px solid rgba(0,229,153,.12);border-radius:10px">
      <span style="font-size:14px;color:#fff;font-weight:600">${title}</span>
      <span style="font-size:13px;color:#999"> — ${desc}</span>
    </td></tr>
   <tr><td style="height:8px;line-height:8px;font-size:8px">&nbsp;</td></tr>`;

const featureTable = (rows: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 4px">${rows}</table>`;

/** Checklist line with a green check glyph (text glyph, not an emoji). */
const checkItem = (text: string) =>
  `<p style="font-size:14px;line-height:1.7;color:#ddd;margin:0 0 6px"><span style="color:#00E599;font-weight:700;margin-right:10px">&#10003;</span>${text}</p>`;

/** Block-explorer tx link per chain; falls back to the bare hash. */
function txLink(chain: string | undefined, txHash: string): { href?: string; short: string } {
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
  const explorers: Record<string, string> = {
    arbitrum: "https://arbiscan.io/tx/",
    ethereum: "https://etherscan.io/tx/",
    base: "https://basescan.org/tx/",
    polygon: "https://polygonscan.com/tx/",
    bsc: "https://bscscan.com/tx/",
    solana: "https://solscan.io/tx/",
  };
  const base = chain ? explorers[chain.toLowerCase()] : undefined;
  return { href: base ? base + txHash : undefined, short };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// ── Auth / onboarding ────────────────────────────────────────────────────────

export function otpEmail(code: string, expiresMinutes = 10): RenderedEmail {
  return {
    subject: `${code} is your Furlpay verification code`,
    html: shell(
      "Verification code",
      p(`Use this code to verify your identity. It expires in ${expiresMinutes} minutes.`) +
        codeBox(code) +
        p(`If you did not request this code, you can safely ignore this email.`)
    ),
    text: `Your Furlpay verification code is ${code}. It expires in ${expiresMinutes} minutes. If you did not request it, ignore this email.`,
  };
}

export function welcomeEmail(name?: string): RenderedEmail {
  const greeting = name ? `Hi ${name},` : "Hi,";
  return {
    subject: "Welcome to Furlpay",
    html: shell(
      "Your account is ready.",
      p(greeting) +
        p(
          `Your Furlpay account is set up: a self-custodial smart account, multi-currency balances, and stablecoin payments on every major chain.`
        ) +
        featureTable(
          featureRow("Visa card", "spend USDC anywhere Visa is accepted") +
            featureRow("Travel", "book flights and hotels, paid in stablecoins") +
            featureRow("Cross-chain swaps", "move value across 60+ chains in one step") +
            featureRow("x402 agent payments", "let software pay software over HTTP")
        ) +
        p(
          `Next step: complete identity verification to unlock cards, on/off-ramp and higher limits.`
        ) +
        cta("https://furlpay.com/profile", "Finish setting up"),
      "Your stablecoin account is live — cards, travel, swaps and agent payments in one app."
    ),
    text: `${greeting}\n\nYour Furlpay account is ready — self-custodial smart account, multi-currency balances, stablecoin payments.\n\nWhat's inside: Visa card (spend USDC anywhere), travel booking in stablecoins, swaps across 60+ chains, x402 agent payments.\n\nNext: complete identity verification to unlock cards and higher limits: https://furlpay.com/profile`,
  };
}

/** Day-1 nudge for accounts that signed up but never started verification.
 *  Distinct from kycStatusEmail, which reports an outcome. */
export function kycReminderEmail(name?: string): RenderedEmail {
  const greeting = name ? `Hi ${name},` : "Hi,";
  return {
    subject: "One step left to unlock your full account",
    html: shell(
      "One step left.",
      p(greeting) +
        p(`Complete identity verification to unlock everything your account can do:`) +
        `<div style="margin:16px 0 4px">` +
        checkItem("Send and receive up to $10,000 per day") +
        checkItem("Virtual Visa card for instant spending") +
        checkItem("Book flights and hotels worldwide") +
        checkItem("Earn yield on idle stablecoins") +
        `</div>` +
        cta("https://furlpay.com/profile", "Verify your identity") +
        p(`<span style="font-size:13px;color:#888">Verification takes about two minutes.</span>`),
      "Verify your identity to unlock cards, higher limits, travel and yield."
    ),
    text: `${greeting}\n\nComplete identity verification to unlock your full account:\n- Send and receive up to $10,000/day\n- Virtual Visa card for instant spending\n- Book flights and hotels worldwide\n- Earn yield on idle stablecoins\n\nVerify (about 2 minutes): https://furlpay.com/profile`,
  };
}

// ── Money movement ───────────────────────────────────────────────────────────

export function paymentReceiptEmail(input: {
  name?: string;
  amountUsd: number;
  token?: string;
  description: string; // "Card purchase at Merchant", "x402 payment", "Swap USDC → ETH"
  chain?: string;
  txHash?: string;
  feeText?: string; // "$0.00", "0.5%"
  dateIso: string;
}): RenderedEmail {
  const tx = input.txHash ? txLink(input.chain, input.txHash) : undefined;
  const amount = `${usd(input.amountUsd)}${input.token ? ` ${input.token}` : ""}`;
  return {
    subject: `Payment receipt: ${amount}`,
    html: shell(
      "Payment confirmed",
      p(`${input.name ? `Hi ${input.name}, your` : "Your"} payment was processed successfully.`) +
        spotlight(amount, input.description) +
        detailsTable(
          row("Description", input.description) +
            row("Date", new Date(input.dateIso).toUTCString()) +
            (input.chain ? row("Network", input.chain) : "") +
            (input.feeText ? row("Fee", input.feeText) : "") +
            (tx
              ? row(
                  "Transaction",
                  tx.href ? `<a href="${tx.href}" style="color:#00E599">${tx.short}</a>` : tx.short
                )
              : "")
        ) +
        p(
          `<span style="font-size:13px;color:#888">Don't recognize this payment? <a href="https://furlpay.com/profile/security" style="color:#00E599">Secure your account</a> immediately.</span>`
        ),
      `${amount} — ${input.description}`
    ),
    text: `Payment confirmed: ${amount} — ${input.description} (${new Date(input.dateIso).toUTCString()})${input.txHash ? `\nTransaction: ${input.txHash}` : ""}\nDon't recognize this payment? Secure your account: https://furlpay.com/profile/security`,
  };
}

export function depositReceivedEmail(input: {
  amount: number;
  token: string;
  chain: string;
  txHash: string;
  confirmations: number;
}): RenderedEmail {
  const tx = txLink(input.chain, input.txHash);
  const amount = `${input.amount} ${input.token}`;
  return {
    subject: `Deposit credited: ${amount}`,
    html: shell(
      "Deposit credited",
      p(`Your on-chain deposit has reached its confirmation target and is credited to your balance.`) +
        spotlight(amount, `on ${input.chain}`) +
        detailsTable(
          row("Network", input.chain) +
            row("Confirmations", String(input.confirmations)) +
            row(
              "Transaction",
              tx.href ? `<a href="${tx.href}" style="color:#00E599">${tx.short}</a>` : tx.short
            )
        ) +
        p(`If you don't recognize this deposit, contact support immediately.`)
    ),
    text: `Deposit credited: ${amount} on ${input.chain} (${input.confirmations} confirmations).\nTransaction: ${input.txHash}\nIf you don't recognize this deposit, contact support.`,
  };
}

export function payrollSummaryEmail(input: {
  count: number;
  totalUsd: number;
  dateIso: string;
}): RenderedEmail {
  return {
    subject: `Payroll run complete: ${input.count} payouts, ${usd(input.totalUsd)}`,
    html: shell(
      "Payroll run complete",
      p(`Your payroll batch has been executed.`) +
        detailsTable(
          row("Payouts", String(input.count)) +
            row("Total", usd(input.totalUsd)) +
            row("Date", new Date(input.dateIso).toUTCString())
        ) +
        cta("https://furlpay.com/payouts", "View payout details")
    ),
    text: `Payroll run complete: ${input.count} payouts totaling ${usd(input.totalUsd)} (${new Date(input.dateIso).toUTCString()}). Details: https://furlpay.com/payouts`,
  };
}

// ── Travel ───────────────────────────────────────────────────────────────────

export function bookingConfirmationEmail(input: {
  guestName?: string;
  tripName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  amountUsd: number;
  reference: string;
  method: string;
  cashbackUsd?: number;
  /** Absolute https URL of the stay/destination photo (CITY_PHOTOS or the
   *  checkout's own image). Omitted = text-only email, which renders fine. */
  heroImageUrl?: string;
  /** Stablecoin equivalent line, e.g. "1589.74 XSGD (MAS-regulated)". */
  stablecoinEquivalent?: string;
  /** Compressed-NFT receipt mint address (shortened for display). */
  receiptNft?: string;
}): RenderedEmail {
  const hero = input.heroImageUrl
    ? `<img src="${input.heroImageUrl}" width="100%" alt="${input.city}" style="display:block;width:100%;max-height:220px;object-fit:cover;border-radius:12px;margin:0 0 16px"/>`
    : "";
  return {
    subject: `Booking confirmed: ${input.tripName}`,
    html: shell(
      "Booking confirmed",
      hero +
        p(
          `${input.guestName ? `Hi ${input.guestName}, your` : "Your"} booking is confirmed. Show the confirmation code at check-in.`
        ) +
        codeBox(input.reference) +
        detailsTable(
          row("Stay", input.tripName) +
            row("City", input.city) +
            row("Check-in", input.checkIn) +
            row("Check-out", input.checkOut) +
            row("Nights / guests", `${input.nights} / ${input.guests}`) +
            row("Paid with", input.method) +
            row("Total", usd(input.amountUsd)) +
            (input.stablecoinEquivalent ? row("Equivalent", input.stablecoinEquivalent) : "") +
            (input.cashbackUsd ? row("Cashback", usd(input.cashbackUsd)) : "") +
            (input.receiptNft
              ? row(
                  "Receipt NFT",
                  `<span style="font-family:ui-monospace,monospace;color:#00E599">${input.receiptNft.slice(0, 6)}…${input.receiptNft.slice(-4)}</span>`
                )
              : "")
        ) +
        cta("https://furlpay.com/travel/my-trips", "View your trip") +
        (input.receiptNft
          ? p(
              `<span style="font-size:13px;color:#888">Your receipt is minted as a compressed NFT on Solana — it cannot be lost, forged, or deleted.</span>`
            )
          : ""),
      `${input.tripName}, ${input.city} — ${input.checkIn} to ${input.checkOut}`
    ),
    text: `Booking confirmed: ${input.tripName}, ${input.city}\nConfirmation code: ${input.reference}\nCheck-in ${input.checkIn} → check-out ${input.checkOut} (${input.nights} nights, ${input.guests} guests)\nTotal ${usd(input.amountUsd)} via ${input.method}${input.cashbackUsd ? ` · cashback ${usd(input.cashbackUsd)}` : ""}${input.receiptNft ? `\nReceipt NFT (Solana): ${input.receiptNft}` : ""}\nYour trips: https://furlpay.com/travel/my-trips`,
  };
}

// ── Digest ───────────────────────────────────────────────────────────────────

/** Weekly account summary. Sender needs a scheduler (Vercel cron) — template
 *  is trigger-agnostic. Category: "welcome" won't fit; send as "ops" until a
 *  dedicated digest category/budget is added. */
export function weeklyDigestEmail(input: {
  name?: string;
  periodLabel: string; // "Jul 7–13, 2026"
  totalUsd: number;
  weeklyChangePct?: number; // signed, e.g. +3.2
  holdings: { token: string; chain: string; amount: number }[];
  txCount: number;
}): RenderedEmail {
  const change =
    input.weeklyChangePct === undefined
      ? ""
      : `<div style="text-align:center;margin:-12px 0 20px"><span style="font-size:14px;font-weight:600;color:${input.weeklyChangePct >= 0 ? "#00E599" : "#F87171"}">${input.weeklyChangePct >= 0 ? "+" : ""}${input.weeklyChangePct.toFixed(1)}% this week</span></div>`;
  const holdingRows = input.holdings
    .slice(0, 5)
    .map((h) =>
      row(
        `${h.token} <span style="color:#666">on ${h.chain}</span>`,
        h.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      )
    )
    .join("");
  return {
    subject: `Your Furlpay week: ${usd(input.totalUsd)} total balance`,
    html: shell(
      `Weekly summary`,
      p(`<span style="font-size:13px;color:#888">${input.periodLabel}</span>`) +
        spotlight(usd(input.totalUsd), "Total balance") +
        change +
        (holdingRows
          ? p(`<b style="color:#fff">Top holdings</b>`) + detailsTable(holdingRows)
          : "") +
        detailsTable(row("Transactions this week", String(input.txCount))) +
        cta("https://furlpay.com/dashboard", "View full dashboard"),
      `${usd(input.totalUsd)} total${input.weeklyChangePct !== undefined ? ` · ${input.weeklyChangePct >= 0 ? "+" : ""}${input.weeklyChangePct.toFixed(1)}% this week` : ""}`
    ),
    text: `Furlpay weekly summary (${input.periodLabel})\n\nTotal balance: ${usd(input.totalUsd)}${input.weeklyChangePct !== undefined ? ` (${input.weeklyChangePct >= 0 ? "+" : ""}${input.weeklyChangePct.toFixed(1)}% this week)` : ""}\n\nTop holdings:\n${input.holdings.slice(0, 5).map((h) => `- ${h.token} on ${h.chain}: ${h.amount}`).join("\n")}\n\nTransactions this week: ${input.txCount}\n\nDashboard: https://furlpay.com/dashboard`,
  };
}

// ── Account status ───────────────────────────────────────────────────────────

export function kycStatusEmail(input: {
  name?: string;
  status: "verified" | "unverified" | "pending";
  tier?: number;
}): RenderedEmail {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  if (input.status === "verified") {
    return {
      subject: "Identity verification approved",
      html: shell(
        "You're verified.",
        p(greeting) +
          p(
            `Your identity verification is complete${input.tier ? ` (tier ${input.tier})` : ""}. Cards, on/off-ramp and full limits are now available on your account.`
          ) +
          cta("https://furlpay.com/cards", "Get your card")
      ),
      text: `${greeting}\n\nYour identity verification is complete${input.tier ? ` (tier ${input.tier})` : ""}. Cards, on/off-ramp and full limits are now unlocked: https://furlpay.com/cards`,
    };
  }
  return {
    subject: "Identity verification needs another attempt",
    html: shell(
      "Verification unsuccessful",
      p(greeting) +
        p(
          `We couldn't complete your identity verification this time. This is usually a document photo issue — good lighting and an unexpired ID resolve most cases.`
        ) +
        cta("https://furlpay.com/profile", "Try again")
    ),
    text: `${greeting}\n\nWe couldn't complete your identity verification. Retry with a clear photo of an unexpired ID: https://furlpay.com/profile`,
  };
}

export function securityAlertEmail(input: {
  name?: string;
  event: string; // "New sign-in", "Passkey added", "Account locked"
  detail?: string; // device / location / provider context
  dateIso: string;
}): RenderedEmail {
  return {
    subject: `Security alert: ${input.event}`,
    html: shell(
      input.event,
      p(`${input.name ? `Hi ${input.name}, we` : "We"} detected the following activity on your account:`) +
        detailsTable(
          row("Event", input.event) +
            (input.detail ? row("Details", input.detail) : "") +
            row("Time", new Date(input.dateIso).toUTCString())
        ) +
        p(`If this was you, no action is needed.`) +
        p(
          `If you don't recognize this activity, lock your account now from Security settings and contact support.`
        ) +
        cta("https://furlpay.com/profile/security", "Review security settings")
    ),
    text: `Security alert: ${input.event}${input.detail ? ` — ${input.detail}` : ""} at ${new Date(input.dateIso).toUTCString()}.\nIf this wasn't you, lock your account: https://furlpay.com/profile/security`,
  };
}

export function earlyAccessWelcome(position: number): RenderedEmail {
  return {
    subject: "You're on the FurlPay early-access list",
    html: shell(
      "You're on the list.",
      p(`The next chapter of finance is programmable — and you'll be among the first in.`) +
        codeBox(`#${position}`) +
        p(
          `That's your place in line. Early members get priority access to the product, first availability for FurlPay Cards where eligible, the stablecoin wallet and cross-chain payments, global travel booking, x402 agent payments, and the developer platform.`
        ) +
        p(`We'll email you the moment your access opens. Until then, explore what's already live:`) +
        cta("https://furlpay.com/developers", "See the developer platform")
    ),
    text: `You're on the FurlPay early-access list — position #${position}.\n\nEarly members get priority product access, first availability for FurlPay Cards where eligible, stablecoin payments, travel booking, x402 agent payments, and developer APIs.\n\nAlready live: https://furlpay.com/developers`,
  };
}

// ── Support ──────────────────────────────────────────────────────────────────

/** Internal notification to the support mailbox for a chat-bubble message. */
export function supportChatNotification(input: {
  message: string;
  transcript?: { from: string; text: string }[];
  visitorEmail?: string;
  page?: string;
}): RenderedEmail {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const history = (input.transcript ?? [])
    .map((m) => `<p style="font-size:13px;line-height:1.5;color:${m.from === "user" ? "#ddd" : "#777"};margin:0 0 6px"><b>${m.from === "user" ? "Visitor" : "Assistant"}:</b> ${esc(m.text)}</p>`)
    .join("");
  return {
    subject: `Support chat: ${input.message.slice(0, 60)}${input.message.length > 60 ? "…" : ""}`,
    html: shell(
      "New support chat message",
      p(`<b style="color:#fff">${esc(input.message)}</b>`) +
        detailsTable(
          (input.visitorEmail ? row("Visitor email", esc(input.visitorEmail)) : "") +
            (input.page ? row("Page", esc(input.page)) : "")
        ) +
        (history ? `<hr style="border:none;border-top:1px solid #222;margin:12px 0"/>${history}` : "")
    ),
    text: `Support chat message: ${input.message}${input.visitorEmail ? `\nVisitor: ${input.visitorEmail}` : ""}${input.page ? `\nPage: ${input.page}` : ""}\n\n${(input.transcript ?? []).map((m) => `${m.from}: ${m.text}`).join("\n")}`,
  };
}

// ── Developer platform ───────────────────────────────────────────────────────

export function developerWelcomeEmail(input: { endpointName?: string }): RenderedEmail {
  return {
    subject: "Your Furlpay developer registration is live",
    html: shell(
      "Registration confirmed",
      p(
        `${input.endpointName ? `Your endpoint "${input.endpointName}" is` : "You're"} registered on the Furlpay x402 network. Agent-native payments — quotes, settlement and receipts — are available immediately.`
      ) +
        p(`Start with the SDKs and the payments API reference in the developer docs.`) +
        cta("https://furlpay.com/developers", "Open developer docs")
    ),
    text: `${input.endpointName ? `Your endpoint "${input.endpointName}" is` : "You're"} registered on the Furlpay x402 network.\nDocs: https://furlpay.com/developers`,
  };
}
