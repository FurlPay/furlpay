import { DocTitle, Lead, H2, H3, P, UL, LI, Code, CodeBlock, Callout, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/stripe-crypto");

export default function StripeCryptoPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Stripe Crypto &amp; Stablecoin</DocTitle>
      <Lead>
        Accept stablecoin payments (settling as fiat USD) and pay out merchant balances using Stripe
        Crypto — powered by the Bridge stablecoin orchestration infrastructure. In Furlpay this is wired
        through <Code>lib/payments/stripe.ts</Code> and two API routes.
      </Lead>

      <H2 id="checkout">1. Stablecoin checkout (PaymentIntents)</H2>
      <P>
        Create a PaymentIntent on the server. With dynamic payment methods, enable <b>Crypto</b> under
        Dashboard → Payments → Payment methods; Stripe then handles network selection (Ethereum, Base,
        Solana, Polygon) and asset support (USDC, USDP) behind the scenes.
      </P>
      <CodeBlock lang="typescript">{`// lib/payments/stripe.ts (server)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function createCryptoPaymentIntent(amountInCents: number) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true }, // card + crypto
    metadata: { integration: 'furlpay_connect_stablecoin' },
  });
  return { clientSecret: paymentIntent.client_secret };
}`}</CodeBlock>
      <P>
        Furlpay exposes this at <Code>POST /api/payments/stripe/intent</Code>, which returns the client
        secret consumed by Stripe Elements.
      </P>

      <H3 id="elements">Render Stripe Elements (frontend)</H3>
      <P>
        Elements renders the wallet connection interface (Phantom, MetaMask, Coinbase Wallet) and handles
        signing via <Code>crypto.stripe.com</Code>. See <Code>components/StripeCryptoCheckout.tsx</Code>.
      </P>
      <CodeBlock lang="tsx">{`'use client';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { docMeta } from "@/lib/docs/meta";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

function CheckoutForm() {
  const stripe = useStripe();
  const elements = useElements();
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: 'https://furlpay.app/dashboard' },
    });
    if (error) console.error(error.message);
  };
  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      <button disabled={!stripe}>Pay with Stablecoin</button>
    </form>
  );
}`}</CodeBlock>

      <H2 id="payouts">2. B2B payouts &amp; transfers</H2>
      <P>
        Send stablecoins to external vendor wallets or pay out merchant balances via the Transfers API.
      </P>
      <CodeBlock lang="typescript">{`export async function transferToMerchantWallet(destination: string, amount: number) {
  return stripe.transfers.create({
    amount,               // amount in cents
    currency: 'usd',
    destination,
    description: 'Furlpay stablecoin settlement payout via Bridge rails',
  });
}`}</CodeBlock>

      <H2 id="security">3. Security best practices</H2>
      <H3>Cryptographic webhook verification</H3>
      <P>
        Never trust events over HTTP without verifying the signature. Stripe signs webhooks with
        HMAC-SHA256; <Code>constructEvent</Code> validates the <Code>stripe-signature</Code> header against
        your endpoint secret and rejects tampered or replayed payloads.
      </P>
      <CodeBlock lang="typescript">{`// app/api/webhooks/stripe/route.ts
export async function POST(request: Request) {
  const payload = await request.text();          // raw body is required
  const sig = request.headers.get('stripe-signature')!;
  try {
    const event = stripe.webhooks.constructEvent(payload, sig, endpointSecret);
    if (event.type === 'payment_intent.succeeded') {
      // credit the Furlpay Safe balance / trigger local bank routing
    }
    return Response.json({ received: true });
  } catch (err) {
    return Response.json({ error: 'Signature verification failed' }, { status: 400 });
  }
}`}</CodeBlock>

      <H3>Tokenized compliance (PCI / KYC offloading)</H3>
      <UL>
        <LI>
          <b>Zero card custody:</b> with Elements, your servers never touch card details or wallet private
          keys — keeping Furlpay in the lowest PCI bracket (SAQ-A).
        </LI>
        <LI>
          <b>Travel Rule:</b> for transactions over $1,000, Stripe/Bridge injects sender/receiver identity
          metadata to satisfy global AML requirements.
        </LI>
      </UL>

      <H3>Network failover &amp; slippage</H3>
      <UL>
        <LI>If an Ethereum transaction fails on a gas spike, dynamic routing falls back to high-speed L2s (Base or Solana).</LI>
        <LI>Slippage limits are set to &lt;0.1% during stablecoin-to-fiat conversion to protect margins.</LI>
      </UL>

      <Callout title="Idempotency">
        Stripe delivers events at least once. Furlpay dedupes by <Code>event.id</Code> so a redelivered
        <Code>payment_intent.succeeded</Code> never double-credits a balance.
      </Callout>

      <DocPager pathname="/docs/integrations/stripe-crypto" />
    </article>
  );
}
