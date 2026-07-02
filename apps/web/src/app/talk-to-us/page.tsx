import type { Metadata } from "next";
import { Mail, MessageSquare, Building2 } from "lucide-react";
import MarketingBar from "@/components/marketing/MarketingBar";
import ContactForm from "@/components/marketing/ContactForm";

export const metadata: Metadata = {
  title: "Talk to us",
  description:
    "Drop your details and the Furlpay team will reach out within 24 hours — for partnerships, enterprise, press, or product questions.",
  alternates: { canonical: "/talk-to-us" },
};

const REASONS = [
  { Icon: Building2, title: "Partnerships & enterprise", body: "Embed Furlpay cards, x402 payments, or the API into your product." },
  { Icon: MessageSquare, title: "Product & support", body: "Questions about the app, developer platform, or integrations." },
  { Icon: Mail, title: "Press & grants", body: "Media requests, ecosystem grants, and investor conversations." },
];

export default function TalkToUsPage() {
  return (
    <div className="min-h-screen bg-oled">
      <MarketingBar />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-14">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          {/* Left: pitch */}
          <div>
            <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">Contact</p>
            <h1 className="text-[40px] font-extrabold leading-tight tracking-tighter sm:text-[48px]">
              Talk to us.
            </h1>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-textSecondary">
              Drop your details and we&apos;ll reach out within 24 hours.
            </p>

            <div className="mt-10 space-y-5">
              {REASONS.map(({ Icon, title, body }) => (
                <div key={title} className="flex gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neon/20 bg-neonSoft text-neon">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold">{title}</p>
                    <p className="text-[13px] leading-relaxed text-textSecondary">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-10 text-[13px] text-textSecondary">
              Prefer email?{" "}
              <a href="mailto:hello@furlpay.com" className="font-semibold text-neon hover:underline">
                hello@furlpay.com
              </a>
            </p>
          </div>

          {/* Right: form */}
          <ContactForm />
        </div>
      </main>
    </div>
  );
}
