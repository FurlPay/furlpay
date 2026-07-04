import type { Metadata } from "next";
import { Check } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import NewsletterSignup from "@/components/newsletter/NewsletterSignup";

export const metadata: Metadata = {
  title: "Waitlist",
  description: "Join the Furlpay waitlist for early access to stablecoin cards, agentic payments, and the developer platform.",
  alternates: { canonical: "/waitlist" },
};

const PERKS = [
  "Early access to stablecoin cards and the Agent Console",
  "First look at new x402 / MCP developer tooling",
  "A say in the roadmap — we build in public",
];

export default function WaitlistPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-xl px-6 pb-24 pt-16 text-center">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Early access</p>
        <h1 className="text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[50px]">
          Get in early.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-textSecondary">
          Furlpay is shipping fast. Join the waitlist and we&apos;ll invite you as we open access.
        </p>

        <ul className="mx-auto mt-8 max-w-sm space-y-2 text-left">
          {PERKS.map((p) => (
            <li key={p} className="flex items-center gap-2 text-[14px] text-textMuted">
              <Check className="h-4 w-4 shrink-0 text-neon" aria-hidden /> {p}
            </li>
          ))}
        </ul>

        <div className="mx-auto mt-8 max-w-md text-left">
          <NewsletterSignup variant="minimal" />
        </div>
      </main>
    </div>
  );
}
