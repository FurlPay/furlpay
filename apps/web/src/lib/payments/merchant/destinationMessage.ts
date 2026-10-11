// The exact text a custody provider signs to register a collection address.
// Pure (no server imports) so the operator console can show it verbatim.
export function registrationMessage(merchantId: string, chain: string, address: string, custodyReference: string) {
  return ["FurlPay collection address registration", `Merchant: ${merchantId}`, `Chain: ${chain}`, `Address: ${address}`, `Custody reference: ${custodyReference}`].join("\n");
}
