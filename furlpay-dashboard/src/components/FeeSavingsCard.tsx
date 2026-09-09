export default function FeeSavingsCard() {
  return (
    <div className="bg-gradient-to-br from-furlpay-500 to-furlpay-600 rounded-xl p-6 text-white shadow-lg">
      <h3 className="font-medium text-furlpay-100 mb-2">Estimated Savings vs Traditional</h3>
      <div className="text-4xl font-bold mb-4">$1,240.50</div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
            <span className="text-furlpay-100">FurlPay Fees (0%)</span>
            <span className="font-medium">$0.00</span>
        </div>
        <div className="flex justify-between">
            <span className="text-furlpay-100">Solana Network Fees</span>
            <span className="font-medium">~$0.05</span>
        </div>
        <div className="flex justify-between pt-2 border-t border-furlpay-400/30">
            <span className="text-furlpay-100">Est. Credit Card Fees (2.9% + 30¢)</span>
            <span className="font-medium opacity-50 line-through">$1,240.55</span>
        </div>
      </div>
    </div>
  );
}
