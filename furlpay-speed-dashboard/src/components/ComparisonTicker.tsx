"use client";

export default function ComparisonTicker() {
  return (
    <div className="w-full overflow-hidden bg-gray-900 border-y border-gray-800 py-3 whitespace-nowrap mt-8">
      <div className="inline-block animate-[marquee_20s_linear_infinite] text-sm text-gray-400">
        <span className="mx-8">🚀 86,400x faster than Visa settlement</span>
        <span className="mx-8">💸 99% cheaper than Stripe</span>
        <span className="mx-8">⚡ Zero fraud chargebacks</span>
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
