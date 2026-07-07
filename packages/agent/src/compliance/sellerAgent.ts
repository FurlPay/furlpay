import { ethers } from "ethers";

// Seller agent — provides inventory and pricing, and is the recipient of
// settled payments. Kept deliberately simple: a static catalogue with USDC
// prices. The recipient address is the seller's wallet.

export interface Quote {
  productId: string;
  description: string;
  amountUsdc: number;
  amountAtomic: bigint;
  recipient: string;
  resource: string; // x402 resource string bound into the payment
}

const CATALOG: Record<string, { description: string; amountUsdc: number }> = {
  "api-credits-small": { description: "10k API credits", amountUsdc: 25 },
  "api-credits-bulk": { description: "1M API credits (bulk)", amountUsdc: 1500 },
  "dataset-license": { description: "Annual dataset license", amountUsdc: 5000 },
};

export class SellerAgent {
  constructor(readonly recipient: string) {}

  quote(productId: string): Quote {
    const item = CATALOG[productId];
    if (!item) throw new Error(`Unknown product: ${productId}`);
    return {
      productId,
      description: item.description,
      amountUsdc: item.amountUsdc,
      amountAtomic: ethers.parseUnits(String(item.amountUsdc), 6),
      recipient: this.recipient,
      resource: `POST /api/agent/purchase/${productId}`,
    };
  }
}
