"use client";

import { useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { postJSON } from "@/lib/api";

// Stripe Crypto checkout for Furlpay Connect. Fetches a stablecoin-enabled
// PaymentIntent from the backend, then renders Stripe Elements (which handles
// wallet connection + signing via crypto.stripe.com). Card details / wallet
// private keys never touch our servers — this keeps Furlpay in PCI SAQ-A.
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

export default function StripeCryptoCheckout({
  amountInCents,
  returnUrl,
}: {
  amountInCents: number;
  returnUrl?: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // postJSON fails fast offline — a checkout can never start without a network.
    postJSON<{ clientSecret?: string; error?: string }>("/api/payments/stripe/intent", {
      amountInCents,
    })
      .then(({ data }) =>
        data.clientSecret
          ? setClientSecret(data.clientSecret)
          : setError(data.error || "Could not start checkout")
      )
      .catch((e) => setError(e.message));
  }, [amountInCents]);

  if (error) return <p className="text-sm text-loss">{error}</p>;
  if (!clientSecret) return <p className="text-sm text-textSecondary">Loading checkout…</p>;

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: "night" } }}>
      <CheckoutForm returnUrl={returnUrl} />
    </Elements>
  );
}

function CheckoutForm({ returnUrl }: { returnUrl?: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl || `${window.location.origin}/dashboard` },
    });
    if (error) {
      setError(error.message ?? "Payment failed");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <button disabled={!stripe || submitting} className="btn-green w-full py-3">
        {submitting ? "Processing…" : "Pay with Stablecoin"}
      </button>
      {error && <p className="text-sm text-loss">{error}</p>}
    </form>
  );
}
