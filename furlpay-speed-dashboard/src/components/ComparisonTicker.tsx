"use client";

export default function ComparisonTicker() {
  return (
    <div className="w-full overflow-hidden bg-gray-900 border-y border-gray-800 py-3 whitespace-nowrap mt-8">
      <div className="inline-block animate-[marquee_20s_linear_infinite] text-sm text-gray-400">
        {/*
          Every claim here must be one a reader could check. The previous copy
          said "99% cheaper than Stripe" (0.5% vs ~2.9% is ~83%, not 99%) and
          "86,400x faster than Visa" (the seconds in a day, comparing our
          settlement against Visa's T+1 while ignoring that Visa AUTHORIZES in
          about a second). Both were indefensible; these are the same advantage
          stated at its real size.
        */}
        <span className="mx-8">🚀 Settles in seconds, not T+1</span>
        <span className="mx-8">💸 0.5% USDC vs ~2.9% + 30¢ card fees</span>
        <span className="mx-8">⚡ No chargebacks — on-chain settlement is final</span>
        <span className="mx-8">🔒 Cryptographically secure</span>
      </div>
      <style jsx>{`
        @keyframes marquee {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  );
}
