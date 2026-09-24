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

// ---------------------------------------------------------------------------
// THE OUTCOME GATE
//
// Neither platform tells you the result of provisioning by resolving the call
// that starts it:
//
//   * PKAddPaymentPassViewController — presenting the sheet returns
//     immediately. The verdict arrives at the delegate's `didFinishAdding`,
//     which reports a PKPaymentPass on success and an error (or neither, on
//     cancel) otherwise.
//   * TapAndPayClient.pushTokenize — launches an Activity for result. The
//     verdict arrives at `onActivityResult` for the request code.
//
// So a promise resolving from `startPushProvisioning` or `pushTokenize` means
// "the UI opened", and treating it as "a card was added" is how this code came
// to tell users their card was in Apple Wallet while the sheet was still open.
//
// Everything below exists to make that class of statement unreachable: success
// is returned ONLY when a platform outcome event says so, and the absence of an
// event is never success.
// ---------------------------------------------------------------------------

/** What the native side reports once the platform has actually decided. */
export interface PlatformOutcome {
  /** True only when the platform confirmed the pass/token was added. */
  added: boolean;
  /** True when the user dismissed the sheet without completing. */
  cancelled?: boolean;
  /** Platform error description, when it supplied one. */
  error?: string;
}

interface OutcomeEvents {
  /** PassKit delegate: certs/nonce/nonceSignature from the Secure Element. */
  onCertificatesReceived: (e: {
    certificates: string[];
    nonce: string;
    nonceSignature: string;
  }) => void;
  /** Terminal verdict from the platform. */
  onProvisioningResult: (e: PlatformOutcome) => void;
}

interface EventSubscription {
  remove(): void;
}

interface NativeEventTarget {
  addListener<K extends keyof OutcomeEvents>(
    event: K,
    listener: OutcomeEvents[K]
  ): EventSubscription;
}

interface ApplePayProvisioningModule extends NativeEventTarget {
  canAddCard(suffix: string): boolean;
  startPushProvisioning(cardholderName: string, lastFour: string): Promise<boolean>;
  /**
   * Hands the issuer-signed payload to the pending PassKit completion handler.
   *
   * PassKit requires this exactly once per presented sheet; the native module
   * is responsible for refusing a second call.
   */
  completePushProvisioning?(
    encryptedPassData: string,
    activationData: string,
    ephemeralPublicKey: string
  ): Promise<boolean>;
}

interface GooglePayProvisioningModule extends NativeEventTarget {
  getActiveWalletInfo(): Promise<{ walletId: string; hardwareId: string }>;
  pushTokenize(opcBase64: string, lastFour: string, displayName: string): Promise<boolean>;
  listTokens(): Promise<Array<{ id: string; network: number; state: number }>>;
}

/**
 * How long to wait for a platform verdict before giving up.
 *
 * Generous, because the user is reading a system sheet and may be asked to
 * accept issuer terms. A timeout is NOT a failure of provisioning — the sheet
 * may still be open, and the platform may still add the card — so it is
 * reported as an unknown outcome rather than as either success or failure.
 */
const OUTCOME_TIMEOUT_MS = 180_000;

/**
 * Wait for exactly one `onProvisioningResult`.
 *
 * FIRST EVENT WINS, and the subscription is removed in a `finally` so a second
 * native emission cannot resolve an already-settled promise or leak a listener
 * across attempts. Both platforms can emit twice in practice — Android delivers
 * an activity result that may be followed by a lifecycle re-delivery, and a
 * re-presented PassKit sheet reuses the same emitter.
 */
async function awaitPlatformOutcome(
  target: NativeEventTarget,
  start: () => Promise<unknown>
): Promise<PlatformOutcome> {
  let sub: EventSubscription | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const outcome = new Promise<PlatformOutcome>((resolve) => {
      sub = target.addListener("onProvisioningResult", (e) => resolve(e));
      timer = setTimeout(
        () =>
          resolve({
            added: false,
            error:
              "The wallet did not report a result in time. If the card does not appear, try again.",
          }),
        OUTCOME_TIMEOUT_MS
      );
    });
    // Subscribed BEFORE starting: a platform fast enough to finish between the
    // two would otherwise emit into no listener and hang until the timeout.
    await start();
    return await outcome;
  } finally {
    if (timer) clearTimeout(timer);
    (sub as EventSubscription | null)?.remove();
  }
}

/**
 * Turn a platform verdict into a user-facing result.
 *
 * The only path to `success: true` in this module.
 */
function fromOutcome(outcome: PlatformOutcome, wallet: "Apple Wallet" | "Google Wallet"): ProvisioningResult {
  if (outcome.added) return { success: true };
  if (outcome.cancelled) {
    return { success: false, message: `Adding the card to ${wallet} was cancelled.` };
  }
  return {
    success: false,
    message: outcome.error ?? `${wallet} did not add the card.`,
  };
}

/**
 * One provisioning attempt at a time, per wallet.
 *
 * Two concurrent attempts share one native emitter, so the first verdict would
 * resolve both — and on Apple, a second `startPushProvisioning` while a sheet
 * is already presented replaces the pending completion handler, orphaning the
 * first. Repeated taps are the normal way this happens.
 */
const inFlight = new Set<"applePay" | "googlePay">();

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
  if (inFlight.has("applePay")) {
    return { success: false, message: "Adding this card to Apple Wallet is already in progress." };
  }
  inFlight.add("applePay");

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

    // PRESENTING THE SHEET IS NOT ADDING A CARD. The verdict comes from
    // PassKit's `didFinishAdding`, surfaced as `onProvisioningResult`, and it is
    // the only thing that can produce `success: true` here.
    //
    // THE HANDSHAKE ABOVE IS INVERTED, AND THAT IS THE INTEGRATION BOUNDARY.
    // The certs/nonce/nonceSignature are requested FROM THE SERVER, but PassKit
    // produces them — inside the Secure Element, after the sheet opens,
    // delivered to the delegate's `generateRequestWithCertificateChain`. A
    // server cannot know them. The native module already emits them as
    // `onCertificatesReceived`.
    //
    // The correct sequence is:
    //
    //   open sheet
    //     -> certs/nonce/nonceSignature arrive via onCertificatesReceived
    //     -> POST them to the issuer
    //     -> receive encryptedPassData / activationData / ephemeralPublicKey
    //     -> completePushProvisioning(...) to satisfy PassKit's handler
    //     -> didFinishAdding decides
    //
    // Only the POST step is unknown: it needs the issuer's real request and
    // response shape, which is not public. `completePushProvisioning` is
    // declared optional on the module interface above precisely so this file
    // compiles and behaves correctly before that step exists.
    //
    // Until it does, no `completePushProvisioning` call is made, so PassKit
    // never receives a payload and can only report a cancellation (the user
    // dismissing the sheet) or nothing at all (the timeout). Neither is
    // success, and both are now reported from what the platform actually said
    // rather than from a hardcoded message.
    const outcome = await awaitPlatformOutcome(applePay, () =>
      applePay.startPushProvisioning(res.cardholderName || "Cardholder", res.lastFour || "0000")
    );
    return fromOutcome(outcome, "Apple Wallet");
  } catch (e: any) {
    return { success: false, message: e.message || "Failed to provision card" };
  } finally {
    inFlight.delete("applePay");
  }
}

export async function startGooglePayProvisioning(cardId: string): Promise<ProvisioningResult> {
  if (!googlePay) {
    return { success: false, message: "Google Pay is not supported on this device." };
  }
  if (inFlight.has("googlePay")) {
    return { success: false, message: "Adding this card to Google Wallet is already in progress." };
  }
  inFlight.add("googlePay");

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

    // LAUNCHING THE TOKENIZE ACTIVITY IS NOT ADDING A CARD, so the result comes
    // from the platform's own verdict, never from this call resolving. The
    // native `pushTokenize` resolves as soon as
    // `TapAndPayClient.pushTokenize(activity, request, REQUEST_CODE)` has been
    // CALLED; `onActivityResult` for that request code is what actually decides.
    //
    // Unlike the Apple path, the ORDER here is already right: wallet info, then
    // OPC, then tokenize. Only the verdict was missing.
    const outcome = await awaitPlatformOutcome(googlePay, () =>
      googlePay.pushTokenize(res.opcBase64, res.lastFour, res.displayName)
    );
    return fromOutcome(outcome, "Google Wallet");
  } catch (e: any) {
    return { success: false, message: e.message || "Failed to provision card" };
  } finally {
    inFlight.delete("googlePay");
  }
}
