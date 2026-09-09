import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session-store';
import CheckoutCard from '@/components/CheckoutCard';
import QRCode from '@/components/QRCode';
import WalletConnect from '@/components/WalletConnect';
import PaymentProgress from '@/components/PaymentProgress';
import Timer from '@/components/Timer';

export default async function CheckoutPage({ params }: { params: { sessionId: string } }) {
  const session = await getSession(params.sessionId);

  if (!session) {
    notFound();
  }

  return (
    <div className="max-w-md mx-auto mt-12 bg-white rounded-xl shadow-lg overflow-hidden border border-gray-100">
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg font-semibold text-gray-700">Checkout</h2>
          <Timer expiresAt={session.expiresAt} />
        </div>
        
        <CheckoutCard session={session} />
        
        <div className="my-8 flex justify-center">
          <QRCode paymentId={session.paymentId} amount={session.amount} />
        </div>

        <div className="space-y-4">
          <WalletConnect session={session} />
          <PaymentProgress paymentId={session.paymentId} successUrl={session.successUrl} />
        </div>
      </div>
    </div>
  );
}
