import Link from "next/link";

// UK financial-promotions compliance blocks. Marketing qualifying cryptoassets
// to UK consumers requires the FCA-prescribed risk warning (COBS 4). We show it
// on every /uk page that touches crypto. We do NOT claim FCA authorisation —
// the authorisation gateway opens 30 Sep 2026 and the regime is mandatory from
// 25 Oct 2027; we state that timeline factually.

// The FCA-prescribed risk warning for Restricted Mass Market Investments
// (qualifying cryptoassets). Wording must not be altered.
export function FcaRiskWarning() {
  return (
    <aside
      role="note"
      className="mt-8 rounded-xl border border-yellow-400/25 bg-yellow-400/[0.06] p-4 text-[13px] leading-relaxed text-yellow-100/90"
    >
      <p>
        <strong>Don&apos;t invest unless you&apos;re prepared to lose all the money you invest.</strong>{" "}
        This is a high-risk investment and you&apos;re unlikely to be protected if something goes
        wrong.{" "}
        <Link href="/uk/trust" className="underline hover:text-white">
          Take 2 minutes to learn more
        </Link>
        .
      </p>
    </aside>
  );
}

// Honest FCA status line — accurate as of July 2026. No claim of authorisation.
export function FcaStatusNote() {
  return (
    <p className="mt-6 text-[11px] leading-relaxed text-textMuted">
      Furlpay is not currently authorised by the Financial Conduct Authority. The FCA cryptoasset
      authorisation gateway opens on 30 September 2026, and the new regime becomes mandatory on 25
      October 2027; Furlpay is preparing for it. Cryptoassets are not regulated deposits, are not
      covered by the Financial Services Compensation Scheme, and can lose value.
    </p>
  );
}
