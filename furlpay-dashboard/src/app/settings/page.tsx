export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-2xl">
        <h3 className="font-semibold mb-4 text-xl">Merchant Profile</h3>
        <form className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Store Name</label>
                <input type="text" defaultValue="Acme Corp" className="w-full px-4 py-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Support Email</label>
                <input type="email" defaultValue="support@acme.com" className="w-full px-4 py-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Settlement Currency</label>
                <select className="w-full px-4 py-2 rounded bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
                    <option>USDC (Solana)</option>
                    <option>SOL</option>
                </select>
            </div>
            <button className="bg-furlpay-600 text-white px-4 py-2 rounded font-medium">Save Changes</button>
        </form>
      </div>
    </div>
  );
}
