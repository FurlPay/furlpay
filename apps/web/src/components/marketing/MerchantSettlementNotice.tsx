import Link from "next/link";

/*
 * The one thing a merchant page must not omit.
 *
 * Every /solutions/* page is an offer: accept USDC, settle in about a second,
 * pay 0.5% instead of 2.9%. The pricing and the API are real and integrable.
 * What is not real yet is the last step — Furlpay broadcasting settlement on
 * the merchant's behalf — because production has no signer, fee payer or
 * Arbitrum RPC endpoint configured, and /api/rails says so on the public
 * record.
 *
 * A hotel or an airline reading "you settle in about a second" would
 * reasonably plan around receiving money. That is the most costly kind of
 * overclaim on this site, so it is stated at the top of every merchant page
 * rather than left to a FAQ, and it is rendered by the shared template so a
 * new solutions page cannot ship without deciding about it.
 */
export default function MerchantSettlementNotice() {
  return (
    <div className="mt-8 max-w-2xl rounded-xl border border-amber-400/25 bg-amber-400/[0.05] p-5 text-[15px] leading-relaxed text-textSecondary">
      <p className="font-semibold text-amber-300">Merchant settlement is in development.</p>
      <p className="mt-1.5">
        The API, fee quotes, EIP-3009 authorizations, hosted checkout and SDKs described here run in
        production and are stable to integrate against today. Furlpay settling those payments to you
        is not yet enabled — the production signer and RPC endpoint are unconfigured, so{" "}
        <a href="/api/rails" className="text-neon hover:underline">
          /api/rails
        </a>{" "}
        reports these rails as not configured and we are not taking live merchant volume.{" "}
        <Link href="/talk-to-us" className="text-neon hover:underline">
          Talk to us
        </Link>{" "}
        to plan an integration ahead of launch.
      </p>
    </div>
  );
}
