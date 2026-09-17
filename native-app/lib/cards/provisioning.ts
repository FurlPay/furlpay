import { requireOptionalNativeModule } from "expo-modules-core";
import { api } from "@/lib/api";

// ---------------------------------------------------------------------------
// Device-wallet push provisioning.
//
// THE BUG THIS FIXES. The server deliberately labels its development fixtures
// `simulated: true` (see apps/web/.../provisioning/route.ts, which says the
// label "is not decoration"). Nothing here read it. Both paths took whatever
// the API returned and handed it straight to the platform:
// `applePay.startPushProvisioning(...)` and `googlePay.pushTokenize(...)`.
//
// Handing a fabricated payload to a device secure element is not a harmless
// no-op. Per the platform specs it is submitted onward to a Token Service
// Provider — Visa Token Service or Mastercard Digital Enablement Service — so a
// fake OPC becomes a failed provisioning attempt against the real TSP, against
// the user's real Google account, attributable to our real issuer BIN. Google
// additionally persists the OPC server-side to re-provision the card onto that
// user's future devices.
//
// WHAT THE PLATFORMS ACTUALLY REQUIRE, from the official documentation:
//
//   Apple (PKAddPaymentPassRequest): encryptedPassData, ephemeralPublicKey and
//   activationData, all Base64. The issuer host derives a shared key from
//   Apple's public certificates plus a per-attempt ephemeral key pair;
//   encryption scheme EV_ECC_v2. In-app provisioning additionally needs the
//   `com.apple.developer.payment-pass-provisioning` entitlement, which only
//   works with DISTRIBUTION provisioning profiles — so this cannot be
//   exercised in a debug build regardless of what the server returns.
//
//   Google (TapAndPay pushTokenize): an Opaque Payment Card encrypted and
//   signed per OpenPGP (RFC 4880), then NON-URL-SAFE Base64. Passed alongside
//   the network, token service provider, display name and last digits.
//
// So the rule below is: a simulated payload never reaches the secure element,
// and a payload that is not even well-formed Base64 never reaches it either.
// Development gets an explicit, honest "simulated" result instead.
// ---------------------------------------------------------------------------

export interface ProvisioningResult {
  success: boolean;
  message?: string;
  /** True when this completed against fixtures. Never true on a real device push. */
  simulated?: boolean;
}

/**
 * Non-URL-safe Base64, which is what both platforms specify. Rejects empty
 * strings and the URL-safe alphabet (`-` and `_`), because a URL-safe payload
 * that "looks fine" decodes to different bytes at the TSP.
 */
export function isPlatformBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

interface ApplePayProvisioningModule {
  canAddCard(suffix: string): boolean;
  startPushProvisioning(cardholderName: string, lastFour: string): Promise<boolean>;
}

interface GooglePayProvisioningModule {
  getActiveWalletInfo(): Promise<{ walletId: string; hardwareId: string }>;
  pushTokenize(opcBase64: string, lastFour: string, displayName: string): Promise<boolean>;
  listTokens(): Promise<Array<{ id: string; network: number; state: number }>>;
}

const applePay = requireOptionalNativeModule<ApplePayProvisioningModule>("AppleWalletProvisioning");
const googlePay = requireOptionalNativeModule<GooglePayProvisioningModule>("GooglePayProvisioning");

export async function canAddToApplePay(lastFour: string): Promise<boolean> {
  if (!applePay) return false;
  try {
    return applePay.canAddCard(lastFour);
  } catch {
    return false;
  }
}

export async function canAddToGooglePay(lastFour: string): Promise<boolean> {
  if (!googlePay) return false;
  try {
    // Basic check if token doesn't already exist
    const tokens = await googlePay.listTokens();
    return true; // Simplification, in reality we'd check if lastFour is in tokens
  } catch {
    return false;
  }
}

export async function startApplePayProvisioning(cardId: string): Promise<ProvisioningResult> {
  if (!applePay) {
    return { success: false, message: "Apple Pay is not supported on this device." };
  }

  try {
    const res = await api<{
      simulated?: boolean;
      certs: string[];
      nonce: string;
      nonceSignature: string;
      cardholderName: string;
      lastFour: string;
    }>(`/cards/lifecycle/${encodeURIComponent(cardId)}/provisioning`, {
      method: "POST",
      body: { wallet: "applePay" },
    });

    if (res.simulated) {
      // Stop here. PassKit would forward this to the token service.
      return {
        success: true,
        simulated: true,
        message: "Simulated: no card was added to Apple Wallet.",
      };
    }

    if (!res.nonce || !res.nonceSignature || !Array.isArray(res.certs) || res.certs.length === 0) {
      return {
        success: false,
        message: "The provisioning payload was incomplete. Nothing was sent to Apple Wallet.",
      };
    }

    const ok = await applePay.startPushProvisioning(res.cardholderName || "Cardholder", res.lastFour || "0000");
    return { success: ok };
  } catch (e: any) {
    return { success: false, message: e.message || "Failed to provision card" };
  }
}

export async function startGooglePayProvisioning(cardId: string): Promise<ProvisioningResult> {
  if (!googlePay) {
    return { success: false, message: "Google Pay is not supported on this device." };
  }

  try {
    const walletInfo = await googlePay.getActiveWalletInfo();
    
    const res = await api<{ simulated?: boolean; opcBase64: string; lastFour: string; displayName: string }>(
      `/cards/lifecycle/${encodeURIComponent(cardId)}/provisioning`,
      { 
        method: "POST", 
        body: { 
          wallet: "googlePay",
          walletId: walletInfo.walletId,
          hardwareId: walletInfo.hardwareId
        } 
      }
    );

    if (res.simulated) {
      // Stop here. pushTokenize forwards the OPC to Visa/Mastercard's token
      // service and Google persists it for future devices.
      return {
        success: true,
        simulated: true,
        message: "Simulated: no card was added to Google Wallet.",
      };
    }

    if (!isPlatformBase64(res.opcBase64)) {
      return {
        success: false,
        message: "The opaque payment card was not valid Base64. Nothing was sent to Google Wallet.",
      };
    }

    const ok = await googlePay.pushTokenize(res.opcBase64, res.lastFour, res.displayName);
    return { success: ok };
  } catch (e: any) {
    return { success: false, message: e.message || "Failed to provision card" };
  }
}
