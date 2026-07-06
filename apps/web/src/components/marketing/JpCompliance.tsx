import Link from "next/link";

// Japan (JFSA) compliance blocks. Since 1 June 2026 USDC is legally classified
// in Japan as an Electronic Payment Instrument (EPI) and distributed by licensed
// providers such as SBI VC Trade. Intermediating or distributing stablecoins in
// Japan requires registration as an Electronic Payment Instrument Exchange
// Service Provider (EPIESP); operating a crypto-asset exchange requires separate
// registration under the Payment Services Act. We do NOT claim either. We state
// the position honestly and show a crypto-asset risk note on every /jp page.

// Crypto-asset risk note for Japan pages.
export function JfsaRiskNote() {
  return (
    <aside
      role="note"
      className="mt-8 rounded-xl border border-yellow-400/25 bg-yellow-400/[0.06] p-4 text-[13px] leading-relaxed text-yellow-100/90"
    >
      <p>
        <strong>Crypto assets are high risk.</strong> Their value can fall as well as rise and you
        could lose the money you put in. Crypto assets are not legal tender. This page is
        information, not financial advice.{" "}
        <Link href="/jp/trust" className="underline hover:text-white">
          Read our Japan risk &amp; JFSA status
        </Link>
        .
      </p>
    </aside>
  );
}

// Honest JFSA status — accurate as of July 2026. No claim of registration.
export function JfsaStatusNote() {
  return (
    <p className="mt-6 text-[11px] leading-relaxed text-textMuted">
      Furlpay is not registered with Japan&apos;s Financial Services Agency (JFSA) as a Crypto-Asset
      Exchange Service Provider or an Electronic Payment Instrument Exchange Service Provider
      (EPIESP). Since 1 June 2026 USDC is legally recognised in Japan as an Electronic Payment
      Instrument, distributed through JFSA-registered intermediaries such as SBI VC Trade; Furlpay is
      evaluating a licensed-intermediary pathway and is not soliciting regulated crypto-asset or
      stablecoin activity from residents of Japan ahead of registration. Crypto assets are not legal
      tender, carry risk, and can lose value.
    </p>
  );
}
