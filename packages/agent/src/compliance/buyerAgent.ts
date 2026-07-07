import { ethers } from "ethers";
import { signAuthorization, type Authorization } from "./chain.js";

// Buyer agent — expresses purchase intent and signs EIP-3009 USDC
// authorizations. In the paper's terms, this is the agent that "initiates the
// transaction by generating a signed payment authorization."

export interface PurchaseIntent {
  productId: string;
  description: string;
  maxAmountUsdc: number;
}

export class BuyerAgent {
  readonly wallet: ethers.Wallet;
  constructor(privateKey: string, provider: ethers.Provider) {
    this.wallet = new ethers.Wallet(privateKey, provider);
  }

  get address(): string {
    return this.wallet.address;
  }

  intent(productId: string, description: string, maxAmountUsdc: number): PurchaseIntent {
    return { productId, description, maxAmountUsdc };
  }

  /** Sign an EIP-3009 authorization paying `value` (atomic USDC) to `to`. */
  async authorize(usdcAddress: string, to: string, value: bigint, chainId: number): Promise<Authorization> {
    return signAuthorization(this.wallet, usdcAddress, to, value, chainId);
  }
}
