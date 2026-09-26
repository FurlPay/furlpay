import type { Metadata } from "next";
import ComparePage from "@/components/marketing/ComparePage";

export const metadata: Metadata = {
  title: "Furlpay vs Airbnb — Pay for Stays with USDC (2026)",
  description:
    "How to pay for Airbnb with stablecoins: Airbnb bills in fiat, but Furlpay issues a single-use, MCC-locked Visa virtual card funded by your USDC so you can book Airbnb and other card-only stays with stablecoins — with on-chain receipts and creator payouts.",
  alternates: { canonical: "/compare/airbnb" },
  openGraph: {
    type: "website",
    url: "https://furlpay.com/compare/airbnb",
    siteName: "Furlpay",
    title: "Furlpay vs Airbnb — Pay for Stays with USDC (2026)",
    description: "How to pay for Airbnb with stablecoins: Airbnb bills in fiat, but Furlpay issues a single-use, MCC-locked Visa virtual card funded by your USDC so you can book Airbnb and other card-only stays with stablecoins — with on-chain receipts and creator payouts.",
    images: [{ url: "/og.png" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Furlpay vs Airbnb — Pay for Stays with USDC (2026)",
    description: "How to pay for Airbnb with stablecoins: Airbnb bills in fiat, but Furlpay issues a single-use, MCC-locked Visa virtual card funded by your USDC so you can book Airbnb and other card-only stays with stablecoins — with on-chain receipts and creator payouts.",
    images: ["/og.png"],
  },
};

export default function Page() {
  return (
    <ComparePage
      competitor="Airbnb"
      slug="airbnb"
      title="Furlpay vs Airbnb"
      subtitle="Airbnb bills in fiat and does not take crypto. Furlpay lets you fund a single-use, MCC-locked Visa virtual card with USDC — so you can pay for an Airbnb (or any card-only stay) with stablecoins, with an on-chain record of the spend."
      developmentNotice={
        <>
          <strong className="text-amber-300">Travel booking on Furlpay is in development.</strong>{" "}
          Hotel discovery is live — the map shows real properties worldwide — but you cannot book or
          pay for a stay through Furlpay today, and the card program and creator payouts have not
          launched. The rows below marked &quot;in development&quot; describe what we are building,
          against a competitor that books today.
        </>
      }
      atomicAnswer={
        <>
          <strong className="text-white">Airbnb</strong> charges in fiat and does not accept cryptocurrency.
          To pay for an Airbnb with stablecoins, <strong className="text-white">Furlpay</strong> issues a
          single-use, merchant-category-locked Visa virtual card funded by your USDC: you top the card with
          stablecoins, Airbnb charges the card in fiat as normal, and you keep an on-chain record of the spend.
          Furlpay also books hotels and flights directly in USDC.
        </>
      }
      rows={[
        { feature: "Pay with stablecoins", furlpay: "USDC via single-use Visa VCN — in development", other: "Not supported", furlpayWins: false },
        { feature: "Direct crypto acceptance", furlpay: "USDC-native for hotels/flights — in development", other: "Fiat only", furlpayWins: false },
        { feature: "On-chain record", furlpay: "Arbiscan receipt — in development", other: "No", furlpayWins: false },
        { feature: "Card controls", furlpay: "Single-use, MCC-locked, capped — in development", other: "Standard card on file", furlpayWins: false },
        { feature: "Stay inventory", furlpay: "Live hotel discovery map; bookable inventory in development", other: "Homes & apartments", furlpayWins: false },
        { feature: "Creator / host earnings", furlpay: "Up to 10% USDC weekly — in development", other: "Host payouts in fiat", furlpayWins: false },
      ]}
      analysis={[
        { title: "How to pay for Airbnb with USDC", body: "Airbnb has no crypto checkout. Furlpay bridges it: you fund a single-use Visa virtual card with USDC, locked to the lodging merchant category and capped at the booking amount. Airbnb charges the card in fiat like any other, and the card cannot be reused or over-charged." },
        { title: "Safer than a card on file", body: "Because the virtual card is single-use, MCC-locked and amount-capped, a compromised listing or a mischarge cannot drain funds — the card is worthless after one authorization. It is a materially safer way to pay an unfamiliar host than a standing card on file." },
        { title: "On-chain record of the spend", body: "The USDC that funds the card leaves an Arbiscan-verifiable trail, so you have a provable record of the payment for expenses or personal accounting, even though Airbnb itself settles in fiat." },
        { title: "Book hotels directly in USDC too", body: "Beyond bridging card-only stays, Furlpay books hotels and flights natively in USDC on Arbitrum, with AI-agent booking over x402 and a creator program that pays up to 10% in USDC weekly." },
      ]}
      faq={[
        { q: "Can you pay for Airbnb with crypto or USDC?", a: "Airbnb does not accept cryptocurrency directly. With Furlpay you fund a single-use, MCC-locked Visa virtual card with USDC and use it at Airbnb checkout — Airbnb charges the card in fiat while you spend stablecoins and keep an on-chain record." },
        { q: "Is paying Airbnb with a Furlpay virtual card safe?", a: "Yes. The card is single-use, locked to the lodging merchant category, and capped at the booking amount, so it cannot be reused or over-charged — safer than leaving a standing card on file with an unfamiliar host." },
        { q: "Does Furlpay also book stays directly?", a: "Yes. Furlpay books hotels and flights directly in USDC on Arbitrum with on-chain receipts, in addition to bridging card-only stays like Airbnb via a virtual card." },
      ]}
    />
  );
}
