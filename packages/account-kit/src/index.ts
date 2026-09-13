// ---------------------------------------------------------------------------
// @furlpay/account-kit — the INTENDED shape of the on-chain account layer:
//   • deploy Safe smart accounts from Passkey (WebAuthn) signers
//   • configure a Paymaster to sponsor gas or bill a developer balance
//   • JS bindings for the time-locked pre-authorization escrow contract
//
// ⚠️  NOTHING HERE TOUCHES A CHAIN. This package is a MOCK. See STATUS.md.
//
// It used to be a mock that did not say so: `deploySafe()` returned
// `deployed: true` for an address derived from a string hash, which no one holds
// keys to and which has never been deployed. A caller — or a UI reading the
// response — had no way to tell that from a real deployment. That is the worst
// shape a placeholder can take on a money surface, and this repository's
// standing rule is to fail visibly instead.
//
// So now:
//   • every result carries `mock: true`,
//   • `deployed` is `false`, because nothing was deployed,
//   • live mode (`mock: false`) THROWS instead of returning fabricated data,
//   • ids come from `crypto.randomUUID()`, not `Math.random()`.
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
  /** True only when a deployment transaction actually confirmed. Always false here. */
  deployed: boolean;
  /** Present and true whenever the result did not come from a chain. */
  mock: true;
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
  /** Present and true whenever the result did not come from a chain. */
  mock?: true;
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

/**
 * A deterministic, NON-DEPLOYED placeholder address.
 *
 * This is NOT a CREATE2 prediction and it is NOT an address anyone controls.
 * It exists so the mock lifecycle has stable identifiers to pass around. Never
 * send funds to a value returned from here.
 */
function mockAddress(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  return "0x" + h.toString(16).padStart(40, "0").slice(0, 40);
}

/** Thrown when a caller asks the mock to do something only a chain can do. */
export class NotImplementedError extends Error {
  constructor(what: string) {
    super(
      `@furlpay/account-kit: ${what} requires a real bundler + deployed contracts, ` +
        `which this package does not have. See packages/account-kit/STATUS.md. ` +
        `Refusing to return a fabricated result.`,
    );
    this.name = "NotImplementedError";
  }
}

export class AccountKit {
  private chain: Chain;
  private mock: boolean;

  constructor(opts: AccountKitOptions = {}) {
    this.chain = opts.chain ?? "base";
    this.mock = opts.mock ?? true;
  }

  /**
   * Compute a placeholder Safe for one or more passkey signers.
   *
   * @deprecated Mock only — deploys nothing. `deployed` is always `false` and
   * `mock` is always `true`. Live mode throws rather than pretending.
   */
  async deploySafe(signers: PasskeySigner[], threshold = 1): Promise<SafeAccount> {
    if (!signers.length) throw new Error("At least one passkey signer is required");
    if (!this.mock) throw new NotImplementedError("deploySafe()");
    const owners = signers.map((s) => mockAddress(s.publicKey));
    const address = mockAddress(owners.join(",") + this.chain);
    return { address, chain: this.chain, owners, threshold, deployed: false, mock: true };
  }

  /** Configure gas sponsorship for a Safe. */
  /** @deprecated Mock only — validates the config and echoes it back. No paymaster is configured. */
  async configurePaymaster(
    safe: string,
    config: PaymasterConfig,
  ): Promise<{ safe: string; config: PaymasterConfig; mock: true }> {
    if (config.mode === "erc20" && !config.feeToken) {
      throw new Error("erc20 paymaster mode requires feeToken");
    }
    if (!this.mock) throw new NotImplementedError("configurePaymaster()");
    return { safe, config, mock: true };
  }

  escrow = {
    /** @deprecated Mock only — holds nothing on chain. */
    create: async (safe: string, merchant: string, amount: number): Promise<EscrowHold> => {
      if (!this.mock) throw new NotImplementedError("escrow.create()");
      if (!(amount > 0)) throw new Error("Escrow amount must be positive");
      return {
        // randomUUID, not Math.random: ids that identify money movement must not
        // come from a predictable PRNG (AGENTS.md rule 6).
        id: "esc_" + crypto.randomUUID(),
        mock: true,
        safe,
        merchant,
        authorizedAmount: amount,
        status: "held",
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      };
    },
    capture: async (hold: EscrowHold, finalAmount: number): Promise<EscrowHold> => {
      if (finalAmount > hold.authorizedAmount) throw new Error("Capture exceeds authorized amount");
      return { ...hold, status: "captured" };
    },
    release: async (hold: EscrowHold): Promise<EscrowHold> => ({ ...hold, status: "released" }),
  };
}

export default AccountKit;
