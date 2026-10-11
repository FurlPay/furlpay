// The exact text a contractor's wallet signs to set its payout address.
// Pure (no server imports) so the contractor page can show and sign it verbatim.
export function payoutAddressMessage(contractorId: string, chain: string, address: string): string {
  return ["FurlPay payroll payout address", `Contractor: ${contractorId}`, `Chain: ${chain}`, `Address: ${address}`,
    "Signing proves this wallet receives my pay. It does not authorize any payment."].join("\n");
}
