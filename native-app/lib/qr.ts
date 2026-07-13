import { EVM_ADDRESS_RE, SOLANA_ADDRESS_RE } from "./format";

/** Pull a payable address out of whatever a QR encodes: a bare EVM or Solana
 *  address, an EIP-681 `ethereum:0x…` / Solana Pay `solana:…` URI, or a
 *  furlpay.com payment link. Returns null when nothing payable is found. */
export function parseScannedAddress(data: string): string | null {
  const bare = data.trim();
  if (EVM_ADDRESS_RE.test(bare) || SOLANA_ADDRESS_RE.test(bare)) return bare;
  // EIP-681. `ethereum:<target>[@chain][/<fn>]?<params>`. When <fn> is a
  // contract call, <target> is the TOKEN CONTRACT and the payee lives in the
  // `address` parameter — returning <target> there would send funds to the
  // token contract itself, where they are unrecoverable. Only treat <target>
  // as the payee for a plain value transfer (no function segment).
  const eip681 = bare.match(/^ethereum:(0x[0-9a-fA-F]{40})(?:@[0-9]+)?(?:\/([A-Za-z_][A-Za-z0-9_]*))?(?:\?(.*))?$/);
  if (eip681) {
    const [, target, fn, query] = eip681;
    if (!fn) return target;
    if (fn !== "transfer" && fn !== "transferFrom") return null;
    const payee = new URLSearchParams(query ?? "").get("address")?.trim();
    return payee && EVM_ADDRESS_RE.test(payee) ? payee : null;
  }

  // Solana Pay: `solana:<recipient>` — the recipient is always the target, but
  // `spl-token` transfers still carry the mint separately, so the target is safe.
  const solPay = bare.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?|$)/);
  if (solPay) return solPay[1];

  // FurlPay payment links: https://(www.)?furlpay.com/pay?to=... or https://(www.)?furlpay.com/pay/...
  if (/^https?:\/\/(?:www\.)?furlpay\.com\//.test(bare)) {
    try {
      const url = new URL(bare);
      const pathParts = url.pathname.split("/");
      if (pathParts[1] === "pay" && pathParts[2]) {
        const addr = pathParts[2].trim();
        if (EVM_ADDRESS_RE.test(addr) || SOLANA_ADDRESS_RE.test(addr)) {
          return addr;
        }
      }
      const toParam = url.searchParams.get("to")?.trim();
      if (toParam && (EVM_ADDRESS_RE.test(toParam) || SOLANA_ADDRESS_RE.test(toParam))) {
        return toParam;
      }
    } catch {
      // fall through
    }
  }

  return null;
}
