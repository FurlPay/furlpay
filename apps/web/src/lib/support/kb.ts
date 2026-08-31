import type { TicketCategory } from "@/lib/support";

// ---------------------------------------------------------------------------
// Support knowledge base — the retrieval corpus the AI answerer grounds on.
//
// The 14 customer help articles live as /docs/help/* pages (TSX, no body data),
// so this file is the machine-readable index of them: real hrefs + the key
// facts + routing metadata. It is the "knowledge base" in the 2026 RAG pattern
// (retrieve relevant entries -> ground the model on them -> cite the source),
// and it deliberately mirrors the published articles rather than inventing
// facts. Keep `content` factual and short; when unsure, point to the article.
// ---------------------------------------------------------------------------

export interface KbEntry {
  id: string;
  title: string;
  /** Canonical help-center URL — cited back to the user as the source. */
  href: string;
  /** Routing hint used when a chat escalates to a ticket. */
  category: TicketCategory;
  keywords: string[];
  /** The grounding text: the key facts, in a few sentences. */
  content: string;
}

export const SUPPORT_KB: KbEntry[] = [
  {
    id: "deposits-withdrawals",
    title: "Deposits & withdrawals",
    href: "/docs/help/deposits-withdrawals",
    category: "stablecoins",
    keywords: ["deposit", "withdraw", "withdrawal", "add money", "cash out", "usdc", "usdt", "top up", "credited", "not credited", "pending deposit"],
    content:
      "Deposits credit to your balance after the transaction confirms on-chain. FurlPay supports USDC and USDT on Arbitrum, Base, Polygon, Ethereum and Solana. Send only supported tokens on a supported network to your deposit address — assets sent on the wrong network can be unrecoverable. Most deposits confirm within minutes; congestion can add delay. If a deposit hasn't appeared after the network's usual confirmation time, have the transaction hash ready so support can trace it.",
  },
  {
    id: "transaction-statuses",
    title: "Understanding transaction statuses",
    href: "/docs/help/transaction-statuses",
    category: "stablecoins",
    keywords: ["status", "pending", "processing", "failed", "confirmed", "stuck", "how long", "transaction status"],
    content:
      "A transaction moves through pending (submitted, awaiting confirmations), confirmed/settled (complete), or failed (reverted — funds are not deducted). Pending is normal during on-chain confirmation. A failed transfer never moves funds. If something is stuck as pending far beyond the usual window, share the transaction hash with support.",
  },
  {
    id: "gasless-transfers",
    title: "Gasless (gas-sponsored) transfers",
    href: "/docs/help/gasless-transfers",
    category: "stablecoins",
    keywords: ["gas", "gasless", "gas fee", "sponsored", "no fee", "network fee", "transfer fee"],
    content:
      "Stablecoin transfers on FurlPay are gas-sponsored — you don't hold native gas tokens to send USDC. FurlPay covers the network fee so you send stablecoins directly. This applies to in-app transfers and card settlement.",
  },
  {
    id: "managing-cards",
    title: "Managing your virtual cards",
    href: "/docs/help/managing-cards",
    category: "cards",
    keywords: ["card", "virtual card", "limit", "limits", "spending limit", "channels", "settlement currency", "issue card", "card controls"],
    content:
      "Virtual cards are funded from your stablecoin balance and can be controlled in-app: set per-transaction and daily limits, toggle channels (online, contactless, ATM), and choose the settlement currency. Card credentials are revealed only after a biometric/passkey re-authentication. Single-use travel cards are MCC-locked to travel merchants.",
  },
  {
    id: "freeze-unfreeze",
    title: "Freeze, unfreeze, or replace a card",
    href: "/docs/help/freeze-unfreeze",
    category: "cards",
    keywords: ["freeze", "unfreeze", "lock card", "block card", "lost card", "stolen", "replace card", "cancel card", "compromised"],
    content:
      "You can freeze a card instantly in the app to block new authorizations, then unfreeze it just as fast. If a card is lost or compromised, freeze it and replace it — the replacement gets a new number while your balance is untouched. Freezing is reversible; replacing is permanent for that card number.",
  },
  {
    id: "declined-transactions",
    title: "Why a card transaction was declined",
    href: "/docs/help/declined-transactions",
    category: "cards",
    keywords: ["declined", "decline", "rejected", "not working", "payment failed", "card declined", "insufficient", "3ds", "3-d secure"],
    content:
      "Common decline reasons: insufficient balance, a per-transaction or daily limit reached, the channel (online/contactless/ATM) disabled, the card frozen, a merchant category blocked by policy, or a failed 3-D Secure check. Check the card's limits and channels first. A 3-D Secure prompt must be approved in-app to complete the payment.",
  },
  {
    id: "kyc-verification",
    title: "KYC verification & tiers",
    href: "/docs/help/kyc-verification",
    category: "kyc",
    keywords: ["kyc", "verify", "verification", "identity", "id", "document", "passport", "tier", "limits raise", "failed verification", "resubmit"],
    content:
      "Identity verification unlocks higher limits and is tiered — each tier raises what you can hold and move. Verification uses a government ID and, at higher tiers, additional checks. If verification fails, it's usually a blurry document, a name/date mismatch, or an unsupported document — you can resubmit. Country eligibility can affect available tiers.",
  },
  {
    id: "passkeys-biometrics",
    title: "Passkeys & biometric login",
    href: "/docs/help/passkeys-biometrics",
    category: "other",
    keywords: ["passkey", "biometric", "face id", "fingerprint", "login", "sign in", "2fa", "mfa", "webauthn", "locked out", "can't log in"],
    content:
      "FurlPay uses passkeys (WebAuthn) — Face ID, fingerprint, or a hardware key — instead of passwords. Sensitive actions like revealing card details or high-value transfers require a fresh biometric confirmation (step-up). If you lose access to your passkey device, account recovery goes through support with identity re-verification.",
  },
  {
    id: "travel-booking",
    title: "Booking travel with stablecoins",
    href: "/docs/help/travel-booking",
    category: "travel",
    keywords: ["travel", "book", "booking", "flight", "hotel", "stay", "car rental", "pay with crypto", "checkout", "rate lock"],
    content:
      "FurlPay Travels lets you book flights, stays and cars and pay in stablecoins (USDC via x402 on Base) or by card. The exchange rate is locked for 15 minutes at checkout so you aren't exposed to volatility. You earn cashback in USDC after the trip completes. Confirmations and e-vouchers are issued instantly.",
  },
  {
    id: "travel-refunds",
    title: "Travel cancellations & refunds",
    href: "/docs/help/travel-refunds",
    category: "travel",
    keywords: ["refund", "cancel", "cancellation", "travel refund", "money back", "dispute booking", "change booking"],
    content:
      "Cancellations follow the supplier's policy shown at booking. Refunds are returned to their source: crypto bookings refund in USDC to your wallet or balance; virtual-card bookings refund to your FurlPay balance. Open the booking in My Trips to cancel. Refund timing depends on the airline or hotel's processing.",
  },
  {
    id: "getting-started",
    title: "Getting started with FurlPay",
    href: "/docs/help/getting-started",
    category: "other",
    keywords: ["get started", "getting started", "new", "sign up", "setup", "onboarding", "how to start", "create account"],
    content:
      "To get started: create an account with a passkey, complete KYC to unlock limits, then add funds by depositing stablecoins. From there you can spend with a virtual card, send gasless transfers, book travel, or invest. The dashboard shows your net worth across on-chain, fiat and equities.",
  },
  {
    id: "privacy-gdpr",
    title: "Privacy, data & GDPR",
    href: "/docs/help/privacy-gdpr",
    category: "other",
    keywords: ["privacy", "gdpr", "data", "delete account", "delete data", "export data", "personal data", "right to erasure"],
    content:
      "You can request access to, export of, or deletion of your personal data. Account deletion removes personal data while retaining records the law requires (on-chain deposit records and the compliance/audit trail). Support tickets and chat mask card numbers, seed phrases and API keys automatically before storage.",
  },
  {
    id: "sdk-integration",
    title: "Developer & SDK integration",
    href: "/docs/help/sdk-integration",
    category: "developers",
    keywords: ["sdk", "api", "developer", "integrate", "webhook", "webhooks", "signature", "node", "python", "go", "rust", "api key"],
    content:
      "FurlPay ships SDKs (Node, Python, Go, Rust) that share one HMAC-SHA256 webhook signature scheme — verify every webhook against your endpoint secret. There's an OpenAPI spec and an MCP server for AI agents. See the developer docs for auth, webhooks, and the x402 gateway.",
  },
  {
    id: "x402-basics",
    title: "x402 pay-per-call basics",
    href: "/docs/help/x402-basics",
    category: "developers",
    keywords: ["x402", "pay per call", "402", "agent payment", "monetize api", "micropayment", "paywall"],
    content:
      "x402 is HTTP-native pay-per-call: a resource responds 402 with payment terms, the caller pays in stablecoins, and the request completes — ideal for agent and API monetization. FurlPay settles x402 in gasless USDC on Base. See the x402 docs to add a paywall or let an agent pay.",
  },
];

/** Lightweight retrieval: token overlap over title/keywords/content, weighted.
 *  No embeddings — the corpus is 14 entries, so exact+fuzzy token scoring is
 *  both sufficient and dependency-free. Returns the best matches, score > 0. */
/**
 * Words that carry no retrieval signal.
 *
 * Not merely noise — actively harmful here, because they appear in every
 * article. Scoring them meant any English sentence matched the whole corpus.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that",
  "this", "from", "have", "has", "can", "how", "what", "why", "when", "where",
  "does", "did", "was", "were", "will", "would", "should", "could", "about",
  "into", "out", "get", "got", "any", "all", "our", "its", "it's", "there",
  "here", "than", "then", "them", "they", "some", "just", "like", "who",
]);

/**
 * A score below this is noise, not a match.
 *
 * One incidental word shared with an article is not a reason to answer from it.
 * Three is roughly "one keyword hit" or "a title word plus a content word" —
 * enough to be about the same subject rather than merely written in English.
 */
const MIN_SCORE = 3;

/** Whole-word test. See the note in `retrieveKb` for why substrings are wrong. */
function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/**
 * Retrieve the articles that actually bear on `query`.
 *
 * WORD BOUNDARIES, NOT SUBSTRINGS. This used to score `content.includes(t)`,
 * which meant "an" matched inside *balance* and *and*, "is" inside *this*, and
 * "of" inside prose everywhere. Every article therefore scored above zero for
 * any English sentence, so the answerer never saw an empty result and never set
 * `escalate` — it answered a question about unladen swallows from the virtual
 * cards article, confidently and with citations.
 *
 * Returning NOTHING is a real and useful answer here: `answerSupportQuestion`
 * turns an empty result into an escalation, which is what should happen when
 * the help centre does not cover something.
 */
export function retrieveKb(query: string, limit = 3): KbEntry[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  if (!tokens.length) return [];

  const scored = SUPPORT_KB.map((entry) => {
    const kw = entry.keywords.join(" ").toLowerCase();
    const title = entry.title.toLowerCase();
    const content = entry.content.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hasWord(kw, t)) score += 3; // keyword hit — strongest signal
      if (hasWord(title, t)) score += 2;
      if (hasWord(content, t)) score += 1;
    }
    return { entry, score };
  });

  return scored
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
