export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-8 text-center">
      <h2 className="text-4xl font-extrabold mb-4">FurlPay Checkout</h2>
      <p className="text-xl text-gray-600 max-w-2xl">
        Fast Solana Payments equivalent to Stripe Checkout.
        Create a checkout session via API to get started.
      </p>
    </div>
  );
}
