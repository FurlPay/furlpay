// ---------------------------------------------------------------------------
// @furlpay/account-kit — programmatic access to the on-chain layer:
//   • deploy Safe smart accounts from Passkey (WebAuthn) signers
//   • configure a Paymaster to sponsor gas or bill a developer balance
//   • JS bindings for the time-locked pre-authorization escrow contract
// The mock provider lets you exercise the full lifecycle without a chain.
// ---------------------------------------------------------------------------

export type Chain = "ethereum" | "polygon" | "base" | "arbitrum" | "gnosis";

export interface PasskeySigner {
  credentialId: string;
  publicKey: string; // COSE / hex public key from the device enclave
}

export interface SafeAccount {
  address: string;
  chain: Chain;
  owners: string[];
  threshold: number;
  deployed: boolean;
}

export interface PaymasterConfig {
  mode: "sponsor" | "erc20";
  /** For erc20 mode, the token gas is deducted in. */
  feeToken?: "USDC" | "EURC";
  /** Developer balance charged for sponsored gas, in USD. */
  developerBalanceUsd?: number;
}

export interface EscrowHold {
  id: string;
  safe: string;
  merchant: string;
  authorizedAmount: number;
  status: "held" | "captured" | "released";
  expiresAt: string;
}

export interface AccountKitOptions {
  chain?: Chain;
  rpcUrl?: string;
  bundlerUrl?: string;
  mock?: boolean;
}

function pseudoAddress(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  return "0x" + h.toString(16).padStart(40, "0").slice(0, 40);
}

export class AccountKit {
  private chain: Chain;
  private mock: boolean;

  constructor(opts: AccountKitOptions = {}) {
    this.chain = opts.chain ?? "base";
    this.mock = opts.mock ?? true;
  }

  /** Compute + deploy a Safe controlled by one or more passkey signers. */
  async deploySafe(signers: PasskeySigner[], threshold = 1): Promise<SafeAccount> {
    if (!signers.length) throw new Error("At least one passkey signer is required");
    const owners = signers.map((s) => pseudoAddress(s.publicKey));
    const address = pseudoAddress(owners.join(",") + this.chain);
    // In live mode this submits a UserOperation through the bundler.
    return { address, chain: this.chain, owners, threshold, deployed: true };
  }

  /** Configure gas sponsorship for a Safe. */
  async configurePaymaster(safe: string, config: PaymasterConfig): Promise<{ safe: string; config: PaymasterConfig }> {
    if (config.mode === "erc20" && !config.feeToken) {
      throw new Error("erc20 paymaster mode requires feeToken");
    }
    return { safe, config };
  }

  escrow = {
    create: async (safe: string, merchant: string, amount: number): Promise<EscrowHold> => ({
      id: "esc_" + Math.random().toString(36).slice(2, 10),
      safe,
      merchant,
      authorizedAmount: amount,
      status: "held",
      expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
    }),
    capture: async (hold: EscrowHold, finalAmount: number): Promise<EscrowHold> => {
      if (finalAmount > hold.authorizedAmount) throw new Error("Capture exceeds authorized amount");
      return { ...hold, status: "captured" };
    },
    release: async (hold: EscrowHold): Promise<EscrowHold> => ({ ...hold, status: "released" }),
  };
}

export default AccountKit;
