import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import FxComparisonClient from "./FxComparisonClient";

// ---------------------------------------------------------------------------
// /calculators/fx-comparison — the high-intent SEO surface.
//
// The strategy this implements is CommBank's own: their home loan calculator
// earns ~200k visits a month because it answers a question people are actively
// typing, rather than describing a product. This does the same for
// "what does my bank actually charge to send money overseas".
//
// THE TITLE AND COPY DO NOT NAME A COMPETITOR IN A CLAIM. Ranking for
// "commbank international transfer fees" does not require asserting anything
// about CommBank in the title tag — the page earns that query by ANSWERING it
// accurately, including the parts that favour the bank (their online fee is
// genuinely $0). A page that overstated it would rank and then get pulled.
//
// Server component so the JSON-LD and copy are in the initial HTML: a crawler
// that does not execute JS still gets the substance, which is the entire point
// of building this as a page rather than a widget.
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: "International Transfer Fee Calculator — Bank FX Margins vs Stablecoin | FurlPay",
  description:
    "Work out what an international transfer really costs from Australia. Compares published bank transfer fees and estimated exchange-rate margins for CommBank, Westpac, ANZ and Wise against sending stablecoins, with sources and dates for every figure.",
  alternates: { canonical: "/calculators/fx-comparison" },
  openGraph: {
    title: "International Transfer Fee Calculator | FurlPay",
    description:
      "Most of the cost of a bank transfer is the exchange-rate margin, not the fee. See both, separately, with sources.",
    url: "/calculators/fx-comparison",
  },
};

export default function FxComparisonPage() {
  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "FurlPay International Transfer Fee Calculator",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            url: "https://furlpay.com/calculators/fx-comparison",
            offers: { "@type": "Offer", price: "0", priceCurrency: "AUD" },
            description:
              "Compares published international transfer fees and estimated exchange-rate margins across Australian banks and stablecoin rails.",
          },
          {
            // FAQ markup earns the "People also ask" slots, and each answer
            // here is one I verified rather than one that flatters FurlPay —
            // the first answer actively corrects a myth in our own favour.
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "Does CommBank charge a fee for international money transfers?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "CommBank waived its upfront fee for international money transfers sent through NetBank, the CommBank app or CommBiz in June 2023, so the online transfer fee is $0. A $30 fee still applies to transfers sent in a branch. The larger cost in both cases is the exchange-rate margin built into the rate you are quoted, which is not shown as a fee.",
                },
              },
              {
                "@type": "Question",
                name: "What is an exchange-rate margin and why does it matter more than the fee?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "An exchange-rate margin is the difference between the mid-market rate and the rate your bank gives you. It is not itemised, so a transfer advertised as fee-free can still cost several percent. On a $5,000 transfer a 3% margin is $150, while the upfront fee may be nothing at all.",
                },
              },
              {
                "@type": "Question",
                name: "Do Australian banks publish their foreign exchange margins?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "No. Australian banks quote a retail exchange rate rather than publishing a margin, and that rate moves during the day. Margins used on this page come from independent rate sampling and vary by currency corridor, so they are shown as estimates rather than quoted prices.",
                },
              },
              {
                "@type": "Question",
                name: "How does sending stablecoins compare?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Sending a dollar-pegged stablecoin such as USDC between two wallets takes no exchange-rate margin, because no currency conversion happens. The cost is the network fee, typically well under a cent on Base. Converting between two different currencies still involves a market spread.",
                },
              },
            ],
          },
        ]}
      />
      <FxComparisonClient />
    </>
  );
}
