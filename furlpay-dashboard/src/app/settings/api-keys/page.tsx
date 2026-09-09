'use client';

export default function ApiKeysPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">API Keys</h1>
      
      <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow">
        <div className="flex justify-between mb-4">
            <h3 className="font-semibold text-xl">Active Keys</h3>
            <button className="bg-furlpay-600 text-white px-4 py-2 rounded text-sm">Generate New Key</button>
        </div>
        
        <div className="space-y-4">
            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded flex justify-between items-center">
                <div>
                    <p className="font-medium">Production Key (Default)</p>
                    <p className="text-sm text-gray-500 font-mono">fp_live_xxxxxxxxxxxxxxxxxxxx</p>
                </div>
                <button className="text-furlpay-600 text-sm font-medium hover:underline">Copy</button>
            </div>
            <div className="p-4 border border-gray-200 dark:border-gray-700 rounded flex justify-between items-center">
                <div>
                    <p className="font-medium">Test Key</p>
                    <p className="text-sm text-gray-500 font-mono">fp_test_xxxxxxxxxxxxxxxxxxxx</p>
                </div>
                <button className="text-furlpay-600 text-sm font-medium hover:underline">Copy</button>
            </div>
        </div>
      </div>
    </div>
  );
}
