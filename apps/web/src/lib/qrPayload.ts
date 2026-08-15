import { classifyAddress } from "@/lib/addressValidation";

// ---------------------------------------------------------------------------
// QR payment-payload parsing.
//
// Lives in lib/ rather than inside ScanToPay.tsx because it is pure logic that
// decides where money is about to be sent, and it deserves direct tests. The
// component file it came from is a client component full of JSX, which the test
// runner cannot transform — so as long as the parser lived there it could only
// be exercised through the UI.
// ---------------------------------------------------------------------------

export interface QrPayment {
  address: string;
  amount?: number;
  token?: string;
}

/** Extract a pay-to address (and optional amount/token) from a QR payload. */
export function parseQrPayload(raw: string): QrPayment | null {
  const text = raw.trim();

  // Furlpay JSON payload: { "address": "0x…", "amount": 25, "token": "USDC" }
  if (text.startsWith("{")) {
    try {
      const j = JSON.parse(text);
      // Was `j.address.length >= 20`, which accepted any 20-character string as
      // an address — the scan "succeeded" and only failed at submit.
      if (typeof j.address === "string" && classifyAddress(j.address)) {
        return { address: j.address.trim(), amount: Number(j.amount) || undefined, token: j.token };
      }
    } catch {
      /* fall through */
    }
  }

  // EIP-681 style: ethereum:0xabc…?value=… / solana:ADDR?amount=…
  // The capture stays permissive; the address is then validated AGAINST THE
  // SCHEME, so `ethereum:<base58 junk>` no longer parses as an EVM address
  // merely because the two alphabets overlap.
  const uri = text.match(/^(ethereum|solana|furlpay):([1-9A-HJ-NP-Za-km-z0-9xa-fA-F]{20,64})(?:\?(.*))?$/);
  if (uri) {
    const [, scheme, candidate, query] = uri;
    const kind = classifyAddress(candidate);
    const schemeMatches =
      kind !== null &&
      (scheme === "furlpay" || // FurlPay links may carry either chain
        (scheme === "ethereum" && kind === "evm") ||
        (scheme === "solana" && kind === "solana"));
    if (!schemeMatches) return null;

    const params = new URLSearchParams(query ?? "");
    const amount = Number(params.get("amount") ?? params.get("value"));
    return {
      address: candidate.trim(),
      amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    };
  }

  // Bare EVM or Solana address.
  if (classifyAddress(text)) return { address: text };
  return null;
}
