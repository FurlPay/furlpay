export default function QRCode({ paymentId, amount }: { paymentId: string; amount: number }) {
  // Stub for a dynamic QR code. In production, use @solana/pay to generate URL and a QR library to render it.
  return (
    <div className="w-48 h-48 bg-gray-200 rounded flex items-center justify-center">
      <span className="text-gray-500 text-sm">QR Code Stub</span>
    </div>
  );
}
