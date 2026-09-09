export default function OnboardingPage() {
  return (
    <div className="max-w-3xl mx-auto mt-12 space-y-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to FurlPay</h1>
        <p className="text-gray-500 text-lg">Let's get your store ready to accept Solana payments.</p>
      </div>
      
      <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg space-y-6">
        <div className="flex items-center gap-4 p-4 border rounded-lg bg-furlpay-50 dark:bg-furlpay-900/20 border-furlpay-200 dark:border-furlpay-800">
            <div className="w-8 h-8 rounded-full bg-furlpay-500 text-white flex items-center justify-center font-bold">1</div>
            <div>
                <h3 className="font-bold">Business Profile</h3>
                <p className="text-sm text-gray-500">Tell us about your business</p>
            </div>
            <button className="ml-auto text-furlpay-600 font-medium">Start</button>
        </div>

        <div className="flex items-center gap-4 p-4 border rounded-lg opacity-50 pointer-events-none">
            <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-700 text-gray-500 flex items-center justify-center font-bold">2</div>
            <div>
                <h3 className="font-bold">Connect Wallet</h3>
                <p className="text-sm text-gray-500">Where you'll receive settlements</p>
            </div>
        </div>

        <div className="flex items-center gap-4 p-4 border rounded-lg opacity-50 pointer-events-none">
            <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-700 text-gray-500 flex items-center justify-center font-bold">3</div>
            <div>
                <h3 className="font-bold">Test Integration</h3>
                <p className="text-sm text-gray-500">Make your first test payment</p>
            </div>
        </div>
      </div>
    </div>
  );
}
