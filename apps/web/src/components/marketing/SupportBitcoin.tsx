import QRCode from "qrcode";
import BitcoinAddress from "./BitcoinAddress";

// ---------------------------------------------------------------------------
// Support FurlPay in Bitcoin.
//
// THE QR IS GENERATED HERE, NOT SHIPPED AS AN IMAGE. A screenshot of a QR code
// is an unverifiable claim about where money goes: nobody reviewing this file
// can read it, and if the wrong address were baked into those pixels the error
// is silent and the loss is irreversible. Generating it from ADDRESS means the
// code and the QR cannot disagree — there is one source of truth on the page,
// and it is the string directly below.
//
// ADDRESS is a bech32 (BIP-173) mainnet P2WPKH address. The checksum was
// verified before it was written here; if you change it, verify the new one
// the same way rather than pasting from a chat message. A bech32 checksum
// catches any single-character typo, which is the failure mode that matters.
//
// WHAT THIS IS NOT. It is not a payment method for FurlPay's own service, and
// nothing here should be worded as though it were. FurlPay settles in USDC —
// see the pricing tiers above this section. This is a donation address for
// people who want to support the work, which is why it sits below the pricing
// and says so plainly. Implying that a Bitcoin transfer buys a plan would be a
// false claim on the one page where a reader is deciding what to pay.
// ---------------------------------------------------------------------------

/** Bech32 mainnet P2WPKH. Checksum-verified. */
const ADDRESS = "bc1q0qa8uqkxv90vyskvhde327evnx03pd2ttamham";

/**
 * BIP-21 URI. Wallets that scan this open with the recipient pre-filled and
 * the amount left blank, so the sender chooses what to give.
 */
const URI = `bitcoin:${ADDRESS}`;

/** How much of the QR the centre logo may cover.
 *
 * Error-correction level H recovers 30% of the symbol, so a logo is safe up to
 * roughly that fraction of the area. This uses ~15% of the width (about 2.3%
 * of the area) — well inside the budget, and deliberately conservative: the
 * recovery margin exists to survive damage and bad lighting in the real world,
 * not to be spent entirely on decoration. */
const LOGO_FRACTION = 0.15;

/**
 * The QR as a single SVG path.
 *
 * One `<path>` rather than ~839 `<rect>` elements: same rendering, a fraction
 * of the DOM, and it scales to any size without resampling — which matters for
 * a QR, where a soft edge is the difference between a scan and a retry.
 */
function qrPath(text: string): { d: string; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const size = qr.modules.size;
  const data = qr.modules.data;
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) {
        // One unit square per dark module.
        d += `M${x} ${y}h1v1h-1z`;
      }
    }
  }
  return { d, size };
}

export default function SupportBitcoin() {
  const { d, size } = qrPath(URI);
  const logo = Math.round(size * LOGO_FRACTION);
  // Centred on the module grid, so the cut-out lands square on the modules
  // rather than straddling them.
  const logoXY = (size - logo) / 2;

  return (
    <section className="mx-auto mt-16 max-w-5xl" aria-labelledby="support-btc-heading">
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 sm:p-10">
        <div className="flex flex-col items-center gap-8 sm:flex-row sm:items-center sm:gap-10">
          {/* QR. Fixed, modest size — this is a supporting detail on a pricing
              page, not its subject. */}
          <div className="shrink-0">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <svg
                viewBox={`0 0 ${size} ${size}`}
                width={148}
                height={148}
                role="img"
                aria-label={`Bitcoin QR code for the address ${ADDRESS}`}
                shapeRendering="crispEdges"
                className="block h-[148px] w-[148px]"
              >
                {/* Quiet zone is provided by the padding around this element,
                    so the symbol itself runs edge to edge. */}
                <path d={d} fill="#e7efea" />
                {/* Punch a hole for the mark, then draw it. The hole is filled
                    with the panel colour rather than left transparent so the
                    logo never sits on top of dark modules. */}
                <circle cx={size / 2} cy={size / 2} r={logo * 0.78} fill="#0b0f0d" />
                {/* The mark is INLINED rather than referenced as
                    /logos/coins/btc.svg through <image href>. An external SVG
                    inside <image> renders inconsistently across browsers, and
                    a QR whose centre is sometimes a blank square is not worth
                    the saved bytes. The glyph below is the ₿ path from that
                    same file, on a circle instead of its original square. */}
                <svg
                  x={logoXY}
                  y={logoXY}
                  width={logo}
                  height={logo}
                  viewBox="0 0 56 56"
                  overflow="visible"
                >
                  <circle cx="28" cy="28" r="28" fill="#F7931A" />
                  <path
                    d="M39.936 24.704c.515-3.494-2.13-5.357-5.773-6.622l1.18-4.708-2.877-.716-1.148 4.592-2.296-.549 1.164-4.625-2.878-.715-1.181 4.725-1.83-.433v-.016l-3.976-.999-.766 3.078s2.13.5 2.096.516c1.165.3 1.365 1.065 1.332 1.664l-1.332 5.39.3.1-.316-.067-1.88 7.537c-.133.35-.5.882-1.314.665.033.05-2.08-.499-2.08-.499l-1.43 3.278 3.743.931 2.046.533-1.198 4.775 2.878.715 1.165-4.725 2.312.599-1.18 4.708 2.877.716 1.181-4.775c4.908.931 8.602.566 10.15-3.877 1.247-3.576-.067-5.623-2.646-6.987 1.88-.416 3.294-1.664 3.66-4.21h.017zm-6.572 9.217c-.882 3.577-6.904 1.63-8.85 1.164l1.58-6.338c1.946.499 8.202 1.447 7.27 5.157v.017zm.882-9.267c-.799 3.244-5.823 1.597-7.437 1.198l1.43-5.74c1.631.4 6.855 1.165 6.007 4.542z"
                    fill="#fff"
                  />
                </svg>
              </svg>
            </div>
          </div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">
              Support the project
            </p>
            <h2
              id="support-btc-heading"
              className="mt-2 text-[28px] font-bold tracking-tighter"
            >
              Send Bitcoin to support FurlPay.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-textSecondary">
              FurlPay is open source and free to start. If the work is useful to you, you can
              support it directly in Bitcoin — scan the code or copy the address below. This is a
              donation, not a subscription: it does not buy a plan, and nothing on this page changes
              if you send it.
            </p>

            <BitcoinAddress address={ADDRESS} />

            <p className="mt-3 text-[12px] leading-relaxed text-textMuted">
              Bitcoin mainnet (bech32) · on-chain transfers are irreversible, so check the first and
              last characters against the address above before you send.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export { ADDRESS as BITCOIN_ADDRESS, URI as BITCOIN_URI };
