import * as React from "react";

// ---------------------------------------------------------------------------
// @furlpay/elements — pre-built, embeddable UI components so merchants never
// touch raw card data or private keys (minimises PCI-DSS / custody burden).
// ---------------------------------------------------------------------------

export interface FurlpayCheckoutButtonProps {
  amount: number;
  currency?: string;
  token?: "USDC" | "USDT" | "EURC" | "PYUSD";
  /** Publishable key (pk_...). */
  publishableKey: string;
  /**
   * Called when a checkout session has been CREATED — not when it has been
   * paid.
   *
   * This callback previously fired with a fabricated `transactionHash` for a
   * payment that had never happened, so a merchant acting on it would ship
   * goods for free. It now hands back a session id and the merchant polls
   * GET /api/checkout/session?id=… , or waits for the webhook, to learn
   * whether money actually moved.
   */
  onSession?: (result: { sessionId: string; status: string; amount: number }) => void;
  onError?: (err: Error) => void;
  baseUrl?: string;
  label?: string;
}

const buttonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  width: "100%",
  padding: "14px 20px",
  borderRadius: 24,
  border: "none",
  background: "#FF3B30",
  color: "#fff",
  fontWeight: 600,
  fontFamily: "Inter, sans-serif",
  fontSize: 16,
  cursor: "pointer",
};

/**
 * A drop-in checkout button that opens a FurlPay checkout session.
 *
 * IT DOES NOT REPORT PAYMENT. Wallet connection and transaction signing are
 * not implemented in this component, and it no longer pretends they are: the
 * previous version slept 500ms to imitate a wallet prompt, then called
 * onSuccess with `"0x" + Math.random()...` whenever the backend was
 * unreachable — meaning it reported a successful payment most confidently
 * when it had least evidence.
 *
 * Payment status comes from the server, which only reports settlement it has
 * observed on-chain.
 */
export function FurlpayCheckoutButton({
  amount,
  currency = "USD",
  token = "USDC",
  publishableKey,
  onSession,
  onError,
  baseUrl = "https://api.furlpay.app",
  label,
}: FurlpayCheckoutButtonProps) {
  const [status, setStatus] = React.useState<"idle" | "creating" | "created" | "error">("idle");

  async function start() {
    setStatus("creating");
    try {
      const res = await fetch(`${baseUrl}/api/checkout/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Furlpay-Key": publishableKey },
        body: JSON.stringify({ amount, currency, token }),
      });

      // FAIL VISIBLY. An unreachable backend means no session exists; the old
      // code treated it as the happy path.
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.message ?? `FurlPay checkout failed (${res.status})`);
      }

      const session = await res.json();
      setStatus("created");
      onSession?.({ sessionId: session.id, status: session.status, amount });
    } catch (e) {
      setStatus("error");
      onError?.(e as Error);
    }
  }

  const text =
    status === "creating"
      ? "Starting checkout"
      : status === "created"
        ? "Awaiting payment"
        : status === "error"
          ? "Checkout unavailable"
          : label || `Pay ${currency} ${amount.toFixed(2)} with ${token}`;

  return (
    <button style={buttonStyle} onClick={start} disabled={status === "creating" || status === "created"}>
      {text}
    </button>
  );
}

export interface FurlpaySecureCardInputProps {
  /** Ephemeral client secret from POST /api/cards (server-side). */
  cardClientSecret: string;
  baseUrl?: string;
  height?: number;
}

/**
 * Renders virtual card credentials (number / expiry / CVV) inside a sandboxed
 * iframe hosted by Furlpay, so the merchant's DOM/servers never see raw PAN.
 */
export function FurlpaySecureCardInput({
  cardClientSecret,
  baseUrl = "https://elements.furlpay.app",
  height = 210,
}: FurlpaySecureCardInputProps) {
  const src = `${baseUrl}/card-view?cs=${encodeURIComponent(cardClientSecret)}`;
  return (
    <iframe
      title="Furlpay secure card details"
      src={src}
      style={{ width: "100%", height, border: "none", borderRadius: 18 }}
      sandbox="allow-scripts allow-same-origin"
      allow="clipboard-write"
    />
  );
}

export const FurlpayElements = { FurlpayCheckoutButton, FurlpaySecureCardInput };

// Headless on-ramp SDK (no UI) — partners drive their own checkout.
export * from "./onramp";
