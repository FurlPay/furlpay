import Link from "next/link";

// UAE (Dubai/VARA) compliance blocks. VARA requires any entity offering virtual
// asset activities in or from Dubai to hold a VARA licence before operating. We
// do NOT claim to be VARA-licensed — we state the position honestly and show a
// virtual-asset risk note on every /ae page that touches crypto.

// Virtual-asset risk note for UAE pages.
export function VaraRiskNote() {
  return (
    <aside
      role="note"
      className="mt-8 rounded-xl border border-yellow-400/25 bg-yellow-400/[0.06] p-4 text-[13px] leading-relaxed text-yellow-100/90"
    >
      <p>
        <strong>Virtual assets are high risk.</strong> Their value can fall as well as rise and you
        could lose the money you put in. This page is information, not financial advice.{" "}
        <Link href="/ae/trust" className="underline hover:text-white">
          Read our UAE risk &amp; VARA status
        </Link>
        .
      </p>
    </aside>
  );
}

// Honest VARA status — accurate as of July 2026. No claim of a VARA licence.
export function VaraStatusNote() {
  return (
    <p className="mt-6 text-[11px] leading-relaxed text-textMuted">
      Furlpay is not currently licensed by Dubai&apos;s Virtual Assets Regulatory Authority (VARA).
      Offering virtual asset services in or from the Emirate of Dubai requires a VARA licence;
      Furlpay is evaluating licensing and is not soliciting regulated virtual asset activity from
      UAE residents ahead of authorisation. Virtual assets are not legal tender, carry risk, and can
      lose value.
    </p>
  );
}
