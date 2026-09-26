import Link from "next/link";

/*
 * One notice, four pricing pages.
 *
 * /pricing, /uk/pricing, /ae/pricing and /jp/pricing each advertise consumer
 * tiers built around a stablecoin card, cashback, yield on idle balances, a
 * local currency account and fractional investing. Not one of those five is
 * available: there is no card program, no brokerage routing, and BANKING_LIVE
 * is marked unimplemented in the flag registry. A price beside a feature is an
 * offer to sell, and these were offers we could not honour.
 *
 * Deleting the tiers would have thrown away a roadmap that is real and worth
 * publishing. Labelling them once, in a component all four pages share, keeps
 * the roadmap visible and stops it reading as a menu — and means the next
 * pricing page cannot accidentally ship without the label.
 */
export default function PlansInDevelopmentNotice({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-5 text-[14px] leading-relaxed text-textSecondary ${className}`}
    >
      <p className="font-semibold text-amber-300">Consumer plans are in development.</p>
      <p className="mt-1.5">
        The tiers below describe what Furlpay is building, not what you can buy today. The card
        program, cashback, yield on idle balances, local currency accounts and stock investing are
        not open — no plan is currently on sale and no card has been issued. What is live now is the
        web app, the passkey wallet and the developer platform, all free.{" "}
        <Link href="/#what-is-running" className="text-neon hover:underline">
          See exactly what is running
        </Link>
        , or{" "}
        <Link href="/early-access" className="text-neon hover:underline">
          join early access
        </Link>{" "}
        to hear when a plan opens.
      </p>
    </div>
  );
}
