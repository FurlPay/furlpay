export default function SuccessScreen() {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
        ✓
      </div>
      <h2 className="text-2xl font-bold mb-2">Payment Successful</h2>
      <p className="text-gray-500 mb-6">Your transaction has been settled.</p>
    </div>
  );
}
