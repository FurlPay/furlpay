import Link from "next/link";
import { Globe, LayoutGrid, LineChart, ShieldCheck, Wallet } from "lucide-react";

// ---------------------------------------------------------------------------
// "Why trade on FurlPay" — the closing band.
//
// Every claim here is one the product can actually stand behind, and two from
// the reference composition are deliberately reworded:
//
//   "Zero-fee stablecoin funding" → "Fund with stablecoins". Fees are a pricing
//   claim; this page is not the pricing page and cannot assert a fee schedule.
//   /pricing owns that, and this card links to it.
//
//   "Secure & regulated" → "Passkey-secured accounts". "Regulated" is a
//   licensing claim about a specific entity in a specific jurisdiction. The
//   security architecture (passkeys, WebAuthn, step-up on money movement) is a
//   fact about the code; the regulatory status is not this component's to
//   assert. /trust owns that, and this card links to it.
//
// A server component: it holds no state and takes no props, so there is no
// reason to ship it to the browser.
// ---------------------------------------------------------------------------

const CARDS = [
  {
    Icon: Globe,
    title: "Real-time global markets",
    body: "Live prices for US equities, ETFs and major crypto on one screen.",
    href: "/markets",
  },
  {
    Icon: LineChart,
    title: "Stocks · ETFs · Crypto",
    body: "Search thousands of tradable assets and follow the ones you care about.",
    href: "/investing",
  },
  {
    Icon: Wallet,
    title: "Fund with stablecoins",
    body: "Move money in with USDC and settle on-chain in seconds.",
    href: "/pricing",
  },
  {
    Icon: ShieldCheck,
    title: "Passkey-secured accounts",
    body: "WebAuthn sign-in, with re-authentication before money moves.",
    href: "/trust",
  },
  {
    Icon: LayoutGrid,
    title: "One dashboard for everything",
    body: "Payments, cards, bills and investments in a single account.",
    href: "/dashboard",
  },
];

export default function WhyFurlPay() {
  return (
    <section className="mt-8 surface-card p-5" aria-labelledby="why-heading">
      <h2 id="why-heading" className="text-[15px] font-bold tracking-tight text-white">
        Why trade on FurlPay?
      </h2>

      <ul className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
        {CARDS.map(({ Icon, title, body, href }) => (
          <li key={title}>
            <Link
              href={href}
              className="flex h-full flex-col rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 transition-colors hover:border-accent/30 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent/[0.12] text-accent">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="mt-2.5 block text-[12.5px] font-bold leading-snug text-white">
                {title}
              </span>
              <span className="mt-1 block text-[11px] leading-relaxed text-textSecondary">{body}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
