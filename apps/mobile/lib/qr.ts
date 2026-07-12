import { EVM_ADDRESS_RE, SOLANA_ADDRESS_RE } from "./format";

/** Pull a payable address out of whatever a QR encodes: a bare EVM or Solana
 *  address, an EIP-681 `ethereum:0x…` / Solana Pay `solana:…` URI, or a
 *  furlpay.com payment link. Returns null when nothing payable is found. */
export function parseScannedAddress(data: string): string | null {
  const bare = data.trim();
  if (EVM_ADDRESS_RE.test(bare) || SOLANA_ADDRESS_RE.test(bare)) return bare;
  const eip681 = bare.match(/^ethereum:(0x[0-9a-fA-F]{40})/);
  if (eip681) return eip681[1];
  const solPay = bare.match(/^solana:([1-9A-HJ-NP-Za-km-z]{32,44})/);
  if (solPay) return solPay[1];
  const inUrl = bare.match(/(0x[0-9a-fA-F]{40})/);
  if (inUrl && /^https?:\/\/(www\.)?furlpay\.com\//.test(bare)) return inUrl[1];
  return null;
}
