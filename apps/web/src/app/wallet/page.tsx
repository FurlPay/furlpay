import type { Metadata, Viewport } from "next";
import WalletClaim from "./WalletClaim";
import JsonLd from "@/components/JsonLd";
import { seoMetadata } from "@/lib/seo/meta";
import { webApplication, faqPage, breadcrumb, howTo, SITE } from "@/lib/seo/schema";
import "./wallet.css";

const URL = `${SITE}/wallet`;

export const viewport: Viewport = {
  themeColor: "#00E599",
};

export const metadata: Metadata = {
  ...seoMetadata({
    title: "FurlPay Wallet Names — Reserve Your Payment Handle",
    ogTitle: "Reserve your FurlPay Wallet name",
    description:
      "Claim yourname.furlpay.com — one human-readable payment handle for you and every AI agent you run. Free to reserve, settled in USDC over the open x402 standard.",
    path: "/wallet",
  }),
  keywords: [
    "wallet name",
    "payment handle",
    "reserve wallet name",
    "AI agent wallet",
    "agentic payments",
    "x402",
    "USDC payments",
    "stablecoin wallet",
    "agent identity",
    "pay per API call",
  ],
  // A reservation funnel: index it, and let crawlers show a full preview.
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

// Answers the questions people actually type. FAQPage + HowTo give search and
// AI answer engines something quotable, which is how a page earns a rich result
// rather than a plain blue link.
const FAQ = [
  {
    q: "What is a FurlPay Wallet name?",
    a: "A FurlPay Wallet name is a human-readable payment handle — yourname.furlpay.com — that your account and any AI agents you run present when they pay for things online. It replaces a long hexadecimal wallet address with a name a person can read, verify and type.",
  },
  {
    q: "How much does it cost to reserve a wallet name?",
    a: "Reserving a FurlPay Wallet name is free. You choose an available name, sign in to your FurlPay account, and authorize the reservation. The name is then bound to your account.",
  },
  {
    q: "Does reserving a name let anything spend my money?",
    a: "No. Reserving a wallet name grants read-only permissions — profile, balances and transaction history. It cannot move money. In FurlPay, moving money always requires a separate, stronger authorization, and an AI agent never receives that implicitly.",
  },
  {
    q: "Why do AI agents need a payment handle?",
    a: "When an AI agent buys an API call, dataset or inference on your behalf, an unlabeled wallet address cannot show which agent acted, whose authority it used, or what it was allowed to spend. A handle bound to an account, combined with a spending policy, answers all three before money moves.",
  },
  {
    q: "What is x402?",
    a: "x402 is an open protocol that uses the HTTP 402 Payment Required status code to attach payment directly to a web request. It was co-created by Coinbase and Cloudflare, and the standard is hosted by the Linux Foundation with members including Stripe, Visa, Mastercard, Google, AWS and Circle. FurlPay settles x402 payments in USDC.",
  },
  {
    q: "What characters can a wallet name use?",
    a: "Three to thirty-two characters, using letters, digits and hyphens, with no leading or trailing hyphen. Names are normalized to lowercase, so capitalization never creates a lookalike name.",
  },
  {
    q: "Which chains does FurlPay settle on?",
    a: "FurlPay settles in USDC across Arbitrum, Base, Ethereum, Solana, Optimism, Polygon, Avalanche and Gnosis.",
  },
];

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ reserved?: string }>;
}) {
  const { reserved } = await searchParams;
  return (
    <>
      <JsonLd
        data={[
          webApplication({
            name: "FurlPay Wallet",
            description:
              "Reserve a human-readable payment handle for your FurlPay account and the AI agents you run. Settled in USDC over the open x402 standard.",
            url: URL,
            category: "FinanceApplication",
          }),
          faqPage(FAQ),
          breadcrumb([
            { name: "Home", path: "/" },
            { name: "Wallet Names", path: "/wallet" },
          ]),
          howTo({
            name: "How to reserve a FurlPay Wallet name",
            description:
              "Claim a human-readable payment handle bound to your FurlPay account in four steps.",
            steps: [
              { name: "Choose a name", text: "Type the handle you want. Availability is checked as you type." },
              { name: "Check availability", text: "A green check means the name is free; names already taken or reserved are rejected." },
              { name: "Sign in", text: "Sign in to your FurlPay account so the handle can be bound to a verified owner." },
              { name: "Authorize", text: "Review the read-only permissions and authorize. The handle is yours from that moment." },
            ],
          }),
        ]}
      />
      <WalletClaim initialReserved={typeof reserved === "string" ? reserved : undefined} />
    </>
  );
}
