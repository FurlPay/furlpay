export default function CheckoutCard({ session }: { session: any }) {
  return (
    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
      <div className="text-sm text-blue-600 font-medium mb-1">{session.merchantId}</div>
      <div className="text-3xl font-bold text-gray-900">
        {session.amount.toFixed(2)} {session.currency}
      </div>
      {session.metadata?.description && (
        <div className="text-sm text-gray-500 mt-2">{session.metadata.description}</div>
      )}
    </div>
  );
}
