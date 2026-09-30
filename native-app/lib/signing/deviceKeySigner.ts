import { addressForSigning, hasWallet, signMessage, signTransaction, signTypedData } from "@/lib/wallet";
import type { Eip1559Transaction } from "@/lib/evm/transaction";
import type { AccountSigner, SignedTransaction, SignerCapabilities, TypedDataPayload } from "./types";
import { SignerUnavailable } from "./types";

// ---------------------------------------------------------------------------
// The on-device key, as an AccountSigner.
//
// This is the signer that exists today: a BIP-39 seed in biometric-gated
// SecureStore, secp256k1 via @noble/curves, never transmitted. Wrapping it in
// the same interface a Ledger or Tangem plugin will implement is what proves
// the abstraction fits something real rather than something imagined — and it
// is the only signer that can be exercised without physical hardware in hand.
//
// Its capabilities are deliberately honest about being the WEAKEST option:
// `trustedDisplay: false`, because the phone renders the transaction and the
// phone also holds the key. That is self-custody on a general-purpose OS, and
// the whole reason someone would add a hardware wallet.
// ---------------------------------------------------------------------------

export class DeviceKeySigner implements AccountSigner {
  readonly kind = "device-key" as const;
  readonly label = "This phone";

  capabilities(): SignerCapabilities {
    return {
      // The phone draws the confirmation AND holds the key. A compromised OS
      // can lie about both, which is precisely what a hardware signer fixes.
      trustedDisplay: false,
      clearSigning: false,
      eip712: true,
      eip1559: true,
      prehashedOnly: false,
      presence: "biometric",
      // A software key is not chain-limited: no firmware has to know about a
      // chain for secp256k1 over a hash to be valid on it.
      supportedChainIds: "all",
    };
  }

  async getAddress(): Promise<string | null> {
    // Reads the un-gated public cache — an address is public the moment it is
    // used on-chain, so showing it must not cost a biometric prompt.
    return addressForSigning();
  }

  async isAvailable(): Promise<boolean> {
    return hasWallet();
  }

  async signTransaction(tx: Eip1559Transaction): Promise<SignedTransaction> {
    if (!(await hasWallet())) {
      throw new SignerUnavailable(
        this.kind,
        "No wallet on this device. Create or import one first."
      );
    }
    // Reading the key triggers the biometric gate, so this call IS the user's
    // approval of exactly this transaction.
    return signTransaction(tx);
  }

  // The two below delegate to the SAME lib/wallet functions WalletConnect used
  // to call directly, so the bytes signed and the biometric gate are unchanged;
  // what changes is that the call now goes through the signer abstraction.

  async signMessage(message: string): Promise<string> {
    await this.requireWallet();
    return signMessage(message);
  }

  async signTypedData(payload: TypedDataPayload): Promise<string> {
    await this.requireWallet();
    return signTypedData(payload);
  }

  private async requireWallet(): Promise<void> {
    if (!(await hasWallet())) {
      throw new SignerUnavailable(this.kind, "No wallet on this device. Create or import one first.");
    }
  }
}

export const deviceKeySigner = new DeviceKeySigner();
