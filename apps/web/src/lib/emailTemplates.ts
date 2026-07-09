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
        p(
          `Next step: complete identity verification to unlock cards, on/off-ramp and higher limits.`
        ) +
        cta("https://furlpay.com/profile", "Finish setting up")
    ),
    text: `${greeting}\n\nYour Furlpay account is ready — self-custodial smart account, multi-currency balances, stablecoin payments.\n\nNext: complete identity verification to unlock cards and higher limits: https://furlpay.com/profile`,
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
        codeBox(amount) +
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
        )
    ),
    text: `Payment confirmed: ${amount} — ${input.description} (${new Date(input.dateIso).toUTCString()})${input.txHash ? `\nTransaction: ${input.txHash}` : ""}`,
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
        codeBox(amount) +
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
            (input.cashbackUsd ? row("Cashback", usd(input.cashbackUsd)) : "")
        ) +
        cta("https://furlpay.com/travel/my-trips", "View your trip")
    ),
    text: `Booking confirmed: ${input.tripName}, ${input.city}\nConfirmation code: ${input.reference}\nCheck-in ${input.checkIn} → check-out ${input.checkOut} (${input.nights} nights, ${input.guests} guests)\nTotal ${usd(input.amountUsd)} via ${input.method}${input.cashbackUsd ? ` · cashback ${usd(input.cashbackUsd)}` : ""}\nYour trips: https://furlpay.com/travel/my-trips`,
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
