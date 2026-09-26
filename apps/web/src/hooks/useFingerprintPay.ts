"use client";

import { useState, useCallback, useEffect } from "react";
import { startAuthentication } from "@simplewebauthn/browser";

export type FingerprintPayState =
  | "idle"
  | "checking_capability"
  | "requesting_challenge"
  | "prompting_biometric"
  | "verifying"
  | "success"
  | "error";

export interface FingerprintPayParams {
  amount: number;
  asset: string;
  recipient: string;
  chain: string;
}

export interface FingerprintPayResult {
  verified: boolean;
  biometricProof?: string;
  error?: string;
}

/**
 * useFingerprintPay — React Hook for 1-Touch Biometric Payments (Fingerprint / Face ID).
 *
 * Implements transaction-bound WebAuthn user verification matching Apple Pay / PhonePe
 * patterns. Forces hardware biometric authentication (userVerification: "required")
 * and obtains a single-use BiometricProof token bound to the specific transaction.
 */
export function useFingerprintPay() {
  const [state, setState] = useState<FingerprintPayState>("idle");
  const [isAvailable, setIsAvailable] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Check if platform authenticator (Touch ID, Face ID, Windows Hello) is available
  useEffect(() => {
    async function checkAvailability() {
      if (
        typeof window !== "undefined" &&
        window.PublicKeyCredential &&
        typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function"
      ) {
        try {
          const available =
            await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
          setIsAvailable(available);
        } catch {
          setIsAvailable(false);
        }
      } else {
        setIsAvailable(false);
      }
    }

    void checkAvailability();
  }, []);

  /**
   * Authorize a payment with Touch ID / Face ID.
   */
  const authorizePayment = useCallback(
    async (params: FingerprintPayParams): Promise<FingerprintPayResult> => {
      setError(null);
      setState("requesting_challenge");

      try {
        // Step 1: Request transaction-bound challenge from server
        const challengeRes = await fetch("/api/wallets/biometric-pay/challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        if (!challengeRes.ok) {
          const errData = await challengeRes.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to initialize biometric challenge.");
        }

        const challengeData = await challengeRes.json();
        const { challengeId, options } = challengeData;

        // Step 2: Trigger on-device biometric prompt (Face ID / Touch ID)
        setState("prompting_biometric");
        let assertion;
        try {
          assertion = await startAuthentication({
            optionsJSON: options,
          });
        } catch (authError: any) {
          if (authError.name === "NotAllowedError") {
            throw new Error("Biometric authentication cancelled or timed out.");
          }
          throw new Error(authError.message || "Biometric sensor error.");
        }

        // Step 3: Verify assertion with server and mint single-use proof
        setState("verifying");
        const verifyRes = await fetch("/api/wallets/biometric-pay/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId,
            assertion,
          }),
        });

        if (!verifyRes.ok) {
          const verifyErr = await verifyRes.json().catch(() => ({}));
          throw new Error(verifyErr.error || "Biometric verification failed.");
        }

        const verifyData = await verifyRes.json();
        setState("success");

        // Optional haptic feedback on mobile browsers (Android / iOS web vibrator)
        if (typeof navigator !== "undefined" && "vibrate" in navigator) {
          try {
            navigator.vibrate([40, 60, 40]);
          } catch {
            // Ignore if vibration is restricted
          }
        }

        return {
          verified: true,
          biometricProof: verifyData.proofId,
        };
      } catch (err: any) {
        const errorMsg = err?.message || "Biometric authorization failed.";
        setError(errorMsg);
        setState("error");
        return {
          verified: false,
          error: errorMsg,
        };
      }
    },
    []
  );

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return {
    state,
    isAvailable,
    error,
    authorizePayment,
    reset,
  };
}
